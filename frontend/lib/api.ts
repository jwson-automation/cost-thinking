'use client';

// サーバー（ホームサーバーの Go）とのやり取り。画面は状態を持たず、ここ経由で読む。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, Card } from './domain';
import { emptyBoard, MEMBERS, memberOf } from './domain';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'https://cost.blueberry-team.com';

async function post<T = Board>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export const fetchBoard = async (): Promise<Board> => {
  const res = await fetch(API_BASE + '/api/state', { cache: 'no-store' });
  return res.json();
};

const titleOf = (board: Board, id: string) => board.cards.find((c) => c.id === id)?.title ?? '';

export const api = {
  createCard: (c: Partial<Card>) => post('/api/cards', c),

  /** チェックリストの消し込み */
  check: (cardId: string, index: number, done: boolean) =>
    post('/api/cards/check', { cardId, index, done }),

  /** 共同のカードで、自分ぶんの着手・保留・完了を動かす */
  progress: (cardId: string, memberId: string, action: 'start' | 'keep' | 'done', text?: string) =>
    post('/api/cards/progress', { cardId, memberId, action, text }),

  /** 会議・共同業務の開始時刻を決める（0 で取り消し） */
  schedule: (cardId: string, startAt: number, text?: string) =>
    post('/api/cards/schedule', { cardId, startAt, text }),

  /** 種別の切り替えと、参加・離脱 */
  kind: (input: { cardId: string; kind?: string; join?: string; leave?: string; text?: string }) =>
    post('/api/cards/kind', input),

  move: (board: Board, cardId: string, to: string, kind: string, from?: string) => {
    const cur = board.cards.find((c) => c.id === cardId);
    const f = from ?? cur?.assignee ?? '';
    const label = { assign: '割り当て', delegate: '委任', escalate: 'エスカレーション', return: '差し戻し' }[kind] ?? kind;
    const text = `${f ? memberOf(f)?.name + ' → ' : ''}${memberOf(to)?.name}：「${cur?.title ?? ''}」を${label}`;
    return post('/api/cards/move', { cardId, to, from: f, kind, text });
  },

  status: (cardId: string, status: string, opts?: { reason?: string; text?: string }) =>
    post('/api/cards/status', { cardId, status, ...opts }),

  join: (board: Board, cardId: string, memberId: string) =>
    post('/api/cards/join', {
      cardId,
      memberId,
      text: `${memberOf(memberId)?.name} が「${titleOf(board, cardId)}」の応援に入りました`,
    }),

  leave: (board: Board, cardId: string, memberId: string) =>
    post('/api/cards/leave', {
      cardId,
      memberId,
      text: `${memberOf(memberId)?.name} が「${titleOf(board, cardId)}」の応援を終えました`,
    }),

  requestHelp: (board: Board, cardId: string, memberId: string, reason: string) =>
    post('/api/help/request', {
      cardId,
      memberId,
      reason,
      minutes: 30,
      text: `${memberOf(memberId)?.name} が応援を要請：「${titleOf(board, cardId)}」／${reason}`,
    }),

  offerHelp: (board: Board, cardId: string, memberId: string) =>
    post('/api/help/offer', {
      cardId,
      memberId,
      text: `${memberOf(memberId)?.name} が「${titleOf(board, cardId)}」の応援に入りました`,
    }),

  resolveHelp: (board: Board, cardId: string, memberId: string, amount: number) =>
    post('/api/help/resolve', {
      cardId,
      memberId,
      text: `「${titleOf(board, cardId)}」が解決しました（+¥${amount.toLocaleString('ja-JP')}）`,
    }),

  saving: (cardId: string, label: string, amount: number) =>
    post('/api/savings', { cardId, label, amount, kind: 'saved' }),

  avatar: (memberId: string, avatar: string) => post('/api/avatar', { memberId, avatar }),

  comment: (cardId: string, memberId: string, text: string) =>
    post('/api/cards/comment', { cardId, memberId, text }),

  updateCard: (input: {
    cardId: string; title: string; summary: string; checklist: string[];
    priority: string; estMin: number; status?: string; text?: string;
  }) => post('/api/cards/update', input),

  reset: () => post('/api/reset', {}),

  seed: () => {
    const now = new Date();
    const at = (h: number, m: number) => {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const id = () => Math.random().toString(36).slice(2, 9);
    return post('/api/seed', {
      cards: [
        {
          id: id(), title: '決済エラー率の調査レポート', summary: '直近1週間の決済失敗ログを分類し、原因ごとの件数を出す。',
          checklist: ['ログ抽出', 'エラー分類', '上位3件の再現'], priority: 'high', complexity: 'high', kind: 'task', estMin: 120,
          checked: [true, false, false],
          participants: ['m3'], assignee: 'm3', status: 'running', startedAt: Date.now() - 22 * 60000, origin: 'predicted', history: [],
        },
        {
          id: id(), title: '週次リリースの手順見直し', summary: '手動確認を減らし、チェックリストを短縮する。',
          checklist: ['現行手順の棚卸し', '自動化できる箇所の抽出'], priority: 'mid', complexity: 'mid', kind: 'coop', estMin: 150,
          participants: ['m2', 'm3'], assignee: 'm2', status: 'running', startedAt: Date.now() - 40 * 60000, origin: 'standard', history: [],
        },
        {
          id: id(), title: 'ヘルプページの文言リライト', summary: '問い合わせの多い3ページを書き直す。',
          checklist: ['問い合わせ上位の特定', 'リライト', '公開'], priority: 'low', complexity: 'low', kind: 'task', estMin: 60,
          participants: [], assignee: '', status: 'unassigned', origin: 'as-is', history: [],
        },
        {
          id: id(), title: '週次の方針すり合わせ', summary: '決めることを3件に絞って短く終わらせる。',
          checklist: ['議題の事前共有', '決定事項の記録'], priority: 'mid', kind: 'meeting', estMin: 45,
          participants: ['m1', 'm2'], assignee: 'm1', status: 'inbox', origin: 'standard', history: [],
        },
        {
          id: id(), title: '昼食', summary: 'この時間はコストに入れません', checklist: [],
          priority: 'low', kind: 'break', breakKind: 'meal', estMin: 60,
          participants: ['m1', 'm2', 'm3'], assignee: '', status: 'inbox', origin: 'break', history: [],
        },
      ],
      savings: [
        { id: id(), cardId: '-', label: '定例MTG 60分 → 30分（参加者6→3）', amount: 38000, at: at(9, 10), kind: 'saved' },
        { id: id(), cardId: '-', label: '仕様確認を口頭 → 非同期コメント', amount: 12400, at: at(11, 5), kind: 'saved' },
      ],
      feed: [
        { id: id(), kind: 'start', text: '田中 りく が「決済エラー率の調査レポート」に着手しました', memberId: 'm3', cardId: '-', at: Date.now() - 22 * 60000 },
      ],
    });
  },
};

export type Candidate = {
  kind: string;
  tag: string;
  title: string;
  summary: string;
  checklist: string[];
  estMin: number;
  note: string;
};

export type CandidateResult = {
  candidates: Candidate[];
  model: string;
  costUsd: number;
  requestId?: string;
  fallback?: boolean;
  reason?: string;
};

export const generateCandidates = (input: {
  goal: string; checklist: string[]; priority: string; complexity: string;
  materials: string; lang: string; kind: string; participants: string[]; hintMin: number;
}, signal?: AbortSignal) =>
  post<CandidateResult>('/api/ai/candidates', {
    goal: input.goal,
    checklist: input.checklist,
    priority: input.priority,
    complexity: input.complexity,
    materials: input.materials,
    lang: input.lang,
    kind: input.kind,
    headcount: Math.max(1, input.participants.length),
    // 見積もりの当たり。AI にはこの前後で考えてもらう。
    hintMin: input.hintMin,
  }, signal);

/** 盤面を購読する。WebSocket が切れたら勝手に張り直す。 */
export function useBoard() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [online, setOnline] = useState(false);
  const [ready, setReady] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    let receivedState = false;

    const connect = () => {
      const url = API_BASE.replace(/^http/, 'ws') + '/ws';
      ws = new WebSocket(url);
      ws.onopen = () => { if (alive) { retry.current = 0; setOnline(true); } };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (alive && msg.type === 'state') {
          receivedState = true;
          setBoard({ ...emptyBoard, ...msg.state });
          setReady(true);
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setOnline(false);
        retry.current = Math.min(retry.current + 1, 6);
        timer = setTimeout(connect, 500 * retry.current);
      };
    };

    fetchBoard().then((b) => {
      if (!alive || receivedState) return;
      setBoard({ ...emptyBoard, ...b });
      setReady(true);
    }).catch(() => {});
    connect();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const refresh = useCallback(async () => {
    setBoard({ ...emptyBoard, ...(await fetchBoard()) });
    setReady(true);
  }, []);
  return { board, setBoard, online, ready, refresh };
}

export const allMembers = MEMBERS;
