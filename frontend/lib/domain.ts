// チームと計算のルール。画面はここの数字を表示するだけにする。

export const WORK_START = 9;      // 出社
export const WORK_END = 18;       // 退社
export const LUNCH: [number, number] = [12, 13];
export const DAY_MINUTES = 480;   // 昼休みを除いた実働8時間

export const HOURS_PER_YEAR = 1920;
export const OVERHEAD = 1.35;     // 社会保険・設備などの間接費

export type GradeKey = 'exec' | 'lead' | 'senior' | 'mid' | 'junior';

export const GRADES: Record<GradeKey, { label: string; annual: number }> = {
  exec: { label: '役員', annual: 18_000_000 },
  lead: { label: 'リード', annual: 11_000_000 },
  senior: { label: 'シニア', annual: 8_500_000 },
  mid: { label: 'ミドル', annual: 6_200_000 },
  junior: { label: 'ジュニア', annual: 4_400_000 },
};

export type AvatarKey = 'lion' | 'bear' | 'cat' | 'dog';
export const AVATARS: AvatarKey[] = ['lion', 'bear', 'cat', 'dog'];

export type Member = {
  id: string;
  name: string;
  grade: GradeKey;
  avatar: AvatarKey;   // 既定の顔。社員が設定で変えられる。
  role: string;
  title: string;
  manager: string | null;
};

/** 3人。manager を書き換えれば段は増やせる。 */
export const MEMBERS: Member[] = [
  { id: 'm1', name: '山口 たける', grade: 'lead', avatar: 'lion', role: 'マネージャー', title: 'マネージャー', manager: null },
  { id: 'm2', name: '山本 さくら', grade: 'senior', avatar: 'bear', role: 'リーダー', title: 'リーダー', manager: 'm1' },
  { id: 'm3', name: '田中 りく', grade: 'junior', avatar: 'cat', role: '担当', title: '担当', manager: 'm2' },
];

/** 社員が設定で選んだ顔。未選択なら既定。 */
export const avatarOf = (board: Board, m: Member): AvatarKey =>
  ((board.avatars?.[m.id] as AvatarKey) || m.avatar);

export const memberOf = (id?: string | null) => MEMBERS.find((m) => m.id === id);
export const subordinates = (id: string) => MEMBERS.filter((m) => m.manager === id);
export const managerOf = (id: string) => memberOf(memberOf(id)?.manager ?? null);

/** 組織を段ごとに並べる */
export function orgLevels(): Member[][] {
  const levels: Member[][] = [];
  let cur = MEMBERS.filter((m) => !m.manager);
  while (cur.length) {
    levels.push(cur);
    cur = cur.flatMap((m) => subordinates(m.id));
  }
  return levels;
}

export const hourlyOf = (grade?: GradeKey) =>
  Math.round((GRADES[grade ?? 'mid'].annual / HOURS_PER_YEAR) * OVERHEAD);

/* ---------- 盤面 ---------- */

export type Assist = { joinedAt: number; leftAt?: number };

/** 会議・共同業務における「その人ぶん」の進み方 */
export type Progress = { startedAt?: number; finishedAt?: number; spentMs?: number };
export type Comment = { id: string; by: string; text: string; at: number; tr?: Record<string, string> };

/** AI が後から入れる訳。無ければ元の文をそのまま出す。 */
export type Tr = { title?: string; summary?: string; checklist?: string[] };
export type Move = { from: string; to: string; kind: string; at: number };
export type Help = { by: string; reason: string; minutes: number; at: number; helpers: string[]; resolvedAt?: number };

export type CardStatus = 'unassigned' | 'inbox' | 'running' | 'keep' | 'done' | 'rejected';

/**
 * カードの種別。誰の時間を、何人ぶん使うかがこれで決まる。
 *   task    … 一般業務。担当ひとりで進める。
 *   meeting … 会議。参加者全員の時間が同時に減る。
 *   coop    … 共同業務。会議と同じく人数ぶん掛かるが、着手・完了は各自で動かす。
 *   break   … 食事・休憩・会食。時間は使うが、金額は積まない。
 */
export type CardKind = 'task' | 'meeting' | 'coop' | 'break';
export type BreakKind = 'meal' | 'rest' | 'party';

export const CARD_KINDS: CardKind[] = ['task', 'meeting', 'coop', 'break'];
export const BREAK_KINDS: BreakKind[] = ['meal', 'rest', 'party'];

/** 休憩の既定の長さ（分）。見積もりを AI に出させる必要がないもの。 */
export const BREAK_MINUTES: Record<BreakKind, number> = { meal: 60, rest: 15, party: 120 };

/** 保存する名前。画面には辞書から出すが、通知や履歴には文字が要る。 */
export const BREAK_LABEL: Record<BreakKind, string> = { meal: '食事', rest: '休憩', party: '会食' };

export const kindOf = (c: Card): CardKind => c.kind ?? 'task';
export const isBreak = (c: Card) => kindOf(c) === 'break';
/** 複数人が同時に動く種別か */
export const isShared = (c: Card) => kindOf(c) === 'meeting' || kindOf(c) === 'coop';

export type Card = {
  id: string;
  title: string;
  summary: string;
  checklist: string[];
  materials?: string;
  priority: 'high' | 'mid' | 'low';
  complexity?: 'high' | 'mid' | 'low';
  kind?: CardKind;
  breakKind?: BreakKind;
  checked?: boolean[];   // チェックリストの消し込み
  lang?: string;         // 作った人が見ていた言語
  startAt?: number;      // 会議・共同業務の予約時刻
  started?: boolean;     // 予約が発火したか
  spentMs?: number;      // 実際に動いていた時間の合計
  progress?: Record<string, Progress>;  // 共同のカードの、ひとりずつの進み方
  estMin: number;
  participants: string[];
  assignee: string;
  status: CardStatus;
  origin?: string;
  rejectReason?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  history?: Move[];
  help?: Help | null;
  assist?: Record<string, Assist>;
  aiModel?: string;
  aiCostUsd?: number;
  comments?: Comment[];
  updatedAt?: number;
  tr?: Record<string, Tr>;
};

/**
 * 表示言語のカード本文。
 *
 * 食事・休憩は人が書いた文ではなく種別そのものなので、保存した文字ではなく
 * 画面の辞書から引く。韓国語で作った「밥 먹기」が日本語画面でもそのまま残る、
 * という状態を作らないため。
 * 業務カードは AI の訳を使い、まだ届いていなければ元の文を出す。
 */
export function cardText(c: Card, lang: string, t?: (key: string) => string) {
  if (isBreak(c) && t) {
    return {
      title: t('break.' + (c.breakKind ?? 'rest')),
      summary: t('break.free'),
      checklist: [] as string[],
      pending: false,
    };
  }
  const tr = c.tr?.[lang];
  return {
    title: tr?.title || c.title,
    summary: tr?.summary || c.summary,
    checklist: tr?.checklist?.length ? tr.checklist : c.checklist,
    // 別の言語で書かれたカードの訳が、まだ届いていない
    pending: !isBreak(c) && !tr?.title && Boolean(c.lang) && c.lang !== lang,
  };
}

/** 表示言語のメモ本文。 */
export const memoText = (m: Comment, lang: string) => m.tr?.[lang] || m.text;

export type Saving = { id: string; cardId: string; label: string; amount: number; at: number; kind: 'saved' | 'missed' };
export type FeedItem = { id: string; kind: string; text: string; memberId: string; cardId: string; at: number };

export type Board = {
  avatars?: Record<string, string>;   // 社員が選んだ顔
  cards: Card[];
  savings: Saving[];
  feed: FeedItem[];
  rev?: number;
  aiSpendUsd?: number;
  aiCalls?: number;
};

export const emptyBoard: Board = { cards: [], savings: [], feed: [] };

/* ---------- 金額 ---------- */

/**
 * チーム標準の時間単価。
 *
 * 個人の時給は画面に出さないし、見積もりにも使わない。
 * 「誰がやるか」で金額が動くと、カードを配るたびに見積もりが変わってしまい、
 * 貯金（見積もりとの差）が何を意味するのか分からなくなるため。
 * 等級ごとの時給を平均し、100円単位に丸めた1本の単価で通す。
 */
export const TEAM_RATE = Math.round(
  MEMBERS.reduce((sum, m) => sum + hourlyOf(m.grade), 0) / MEMBERS.length / 100,
) * 100;

/** 応援中の人（担当を除く） */
export const assistantsOf = (c: Card) =>
  Object.entries(c.assist ?? {})
    .filter(([id, a]) => !a.leftAt && id !== c.assignee)
    .map(([id]) => id);

export const isOwner = (c: Card, id: string) => c.assignee === id;
export const isAssisting = (c: Card, id: string) => assistantsOf(c).includes(id);

/** 何人ぶんの時間を使うカードか */
export function headcountOf(c: Card): number {
  if (isShared(c)) return Math.max(1, (c.participants ?? []).length);
  return 1;
}

/**
 * 見積もりコスト = 見積もり時間 × 人数 × チーム標準単価。
 * 休憩・食事・会食は時間だけ使い、金額は積まない。
 */
export function costOf(c: Card, now = Date.now()): number {
  if (isBreak(c)) return 0;
  let minutes = (c.estMin || 0) * headcountOf(c);
  // 応援に入った人は、実際に付き合った時間ぶんだけ上乗せする
  Object.entries(c.assist ?? {}).forEach(([id, a]) => {
    if (id === c.assignee || (c.participants ?? []).includes(id)) return;
    const end = a.leftAt || c.finishedAt || now;
    minutes += Math.max(0, end - a.joinedAt) / 60000;
  });
  return Math.round((minutes / 60) * TEAM_RATE);
}

/** 応援した人がこのカードに積んでいる金額 */
export function assistCostOf(c: Card, memberId: string, now = Date.now()): number {
  const a = c.assist?.[memberId];
  if (!a || isBreak(c)) return 0;
  const end = a.leftAt || c.finishedAt || now;
  return Math.round((Math.max(0, end - a.joinedAt) / 60000 / 60) * TEAM_RATE);
}

/**
 * 実際に動いていた時間（分）。
 * 会議で中断された間は数えない。会議に呼ばれたせいで見積もり超過になり、
 * 貯金が消えるのは筋が通らないため。
 */
export function spentMinutes(c: Card, now = Date.now()): number {
  let ms = c.spentMs ?? 0;
  if (c.startedAt && !c.finishedAt) ms += now - c.startedAt;
  else if (c.startedAt && c.finishedAt && !c.spentMs) ms += c.finishedAt - c.startedAt;
  return Math.max(0, Math.round(ms / 60000));
}

/** 一度でも手をつけたカードか */
export const hasWorked = (c: Card) => Boolean(c.startedAt || c.spentMs);

/* ---------- 共同のカードの、ひとりぶん ---------- */

/** その人がこのカードでどこまで進んだか。共同でなければカード全体の状態を返す。 */
export function myState(c: Card, me: string): 'idle' | 'running' | 'done' {
  if (!isShared(c)) {
    if (c.status === 'done') return 'done';
    return c.status === 'running' ? 'running' : 'idle';
  }
  const p = c.progress?.[me];
  if (p?.finishedAt) return 'done';
  if (p?.startedAt) return 'running';
  return 'idle';
}

/** その人がこのカードに使った時間（分） */
export function mySpentMinutes(c: Card, me: string, now = Date.now()): number {
  if (!isShared(c)) return spentMinutes(c, now);
  const p = c.progress?.[me];
  if (!p) return 0;
  let ms = p.spentMs ?? 0;
  if (p.startedAt && !p.finishedAt) ms += now - p.startedAt;
  return Math.max(0, Math.round(ms / 60000));
}

/** 完了した人数 / 参加人数 */
export function doneCountOf(c: Card) {
  const ids = c.participants ?? [];
  return { done: ids.filter((id) => c.progress?.[id]?.finishedAt).length, total: ids.length };
}

/** その人ぶんの貯金。共同でも「自分が見積もりより早く終えたぶん」で数える。 */
export function savedByOf(c: Card, me: string, now = Date.now()): number {
  if (isBreak(c)) return 0;
  const spent = isShared(c) ? mySpentMinutes(c, me, now) : spentMinutes(c, now);
  const diff = Math.max(0, (c.estMin || 0) - spent);
  const heads = isShared(c) ? 1 : headcountOf(c); // 共同は自分ぶんだけ
  return Math.round(((diff * heads) / 60) * TEAM_RATE);
}

/**
 * 見積もりより早く終わったぶんの金額＝貯金。
 * 超過したら0（マイナスの貯金は作らない）。休憩系は対象外。
 */
export function savedOf(c: Card, actualMin: number): number {
  if (isBreak(c)) return 0;
  const diff = Math.max(0, (c.estMin || 0) - actualMin);
  return Math.round(((diff * headcountOf(c)) / 60) * TEAM_RATE);
}

/**
 * 見積もり時間の当たり（分）。AI が落ちてもこの式で必ず数字が出る。
 *
 *   下ごしらえ30分 + 期待結果1件につき20分 + 目標の文字数20字につき15分
 *   × 複雑度（かんたん0.7 / ふつう1.0 / むずかしい1.6）
 *
 * 会議は「人数が増えるほど長くなる」ので別式。休憩は決め打ち。
 * 15分単位に丸め、1日ぶん（480分）を超えないようにする。
 */
export function estimateMinutes(input: {
  goal: string;
  checklist: string[];
  complexity?: 'high' | 'mid' | 'low';
  kind?: CardKind;
  breakKind?: BreakKind;
  participants?: string[];
}): number {
  const round = (n: number) => Math.min(480, Math.max(15, Math.round(n / 15) * 15));
  if (input.kind === 'break') return BREAK_MINUTES[input.breakKind ?? 'rest'];
  if (input.kind === 'meeting') {
    return round(30 + 15 * Math.max(1, (input.participants ?? []).length));
  }
  const base = 30 + input.checklist.length * 20 + Math.floor(input.goal.length / 20) * 15;
  const factor = input.complexity === 'high' ? 1.6 : input.complexity === 'low' ? 0.7 : 1;
  return round(base * factor);
}

/** そのカードに時間を使う人か（担当 or 参加者） */
export const involves = (c: Card, memberId: string) =>
  c.assignee === memberId || (c.participants ?? []).includes(memberId);

/** その日に抱えている見積もり時間（分） */
export function assignedMinutes(board: Board, memberId: string): number {
  return board.cards
    .filter((c) => involves(c, memberId) && !['done', 'rejected'].includes(c.status))
    .reduce((s, c) => s + (c.estMin || 0), 0);
}

export const loadRatio = (board: Board, memberId: string) => assignedMinutes(board, memberId) / DAY_MINUTES;
export const runningCards = (board: Board, memberId: string) =>
  board.cards.filter((c) => c.status === 'running' && involves(c, memberId));
export const openHelpRequests = (board: Board) =>
  board.cards.filter((c) => c.help && !c.help.resolvedAt && c.status !== 'done');

export const totalSaved = (board: Board) =>
  board.savings.filter((s) => s.kind === 'saved').reduce((a, b) => a + b.amount, 0);

/* ---------- 表示用 ---------- */

export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
export const hoursText = (min: number) => (min / 60).toFixed(1) + 'h';

/** time 入力に入れる "HH:MM" */
export const clockOf = (ts: number) => {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

export const hhmm = (ts: number) => {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

export function elapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's';
}

export const hourFraction = (ts: number) => {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60;
};

/** ドル建ての実費を円の目安で見せる */
export const USD_JPY = 150;
export function yenFromUsd(usd?: number) {
  const jpy = (usd ?? 0) * USD_JPY;
  if (!jpy) return '¥0';
  return '¥' + (jpy < 1 ? jpy.toFixed(3) : jpy.toFixed(2));
}

export const PRIORITY = {
  high: { key: 'priority.high', cls: 'p-high' },
  mid: { key: 'priority.mid', cls: 'p-mid' },
  low: { key: 'priority.low', cls: 'p-low' },
} as const;
