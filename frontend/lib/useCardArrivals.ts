'use client';

// 「まだ見ていない仕事」を覚えておく。
//
// 画面を開きっぱなしにしている人にだけ届くのでは足りない。席を外していた人が
// あとで自分の仕事を開いたときにも、受け取っていないカードはちゃんと届く。
// 見たかどうかは本人のブラウザに置く（サーバーの盤面は全員で共有しているため、
// 「誰が見たか」を混ぜると他の人の画面まで静かになってしまう）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { involves, isBreak, myState, type Card } from './domain';

const keyOf = (memberId: string) => `ct-seen-${memberId}`;

function loadSeen(memberId: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyOf(memberId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(memberId: string, ids: Set<string>) {
  try {
    // 増え続けないように、直近ぶんだけ残す
    localStorage.setItem(keyOf(memberId), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* プライベートウィンドウなどでは保存できない。動作は続ける。 */
  }
}

/** 届いていて、まだ本人が確認していないカード */
export function useCardArrivals(cards: Card[], memberId: string | null, ready: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const loadedFor = useRef<string | null>(null);
  const [unseen, setUnseen] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || !memberId) {
      loadedFor.current = null;
      setUnseen([]);
      return;
    }
    if (loadedFor.current !== memberId) {
      seen.current = loadSeen(memberId);
      loadedFor.current = memberId;
    }

    // 自分の、まだ動かしていない仕事だけが「届いた」と言える
    const waiting = cards.filter(
      (c) =>
        involves(c, memberId) &&
        !isBreak(c) &&
        c.status !== 'rejected' &&
        myState(c, memberId) === 'idle',
    );

    // 自分で着手・完了したものは、見たものとして畳んでおく
    let touched = false;
    cards.forEach((c) => {
      if (involves(c, memberId) && myState(c, memberId) !== 'idle' && !seen.current.has(c.id)) {
        seen.current.add(c.id);
        touched = true;
      }
    });
    if (touched) saveSeen(memberId, seen.current);

    setUnseen(waiting.filter((c) => !seen.current.has(c.id)).map((c) => c.id));
  }, [cards, memberId, ready]);

  const dismiss = useCallback(
    (id?: string) => {
      if (!memberId) return;
      if (id) seen.current.add(id);
      else unseen.forEach((x) => seen.current.add(x));
      saveSeen(memberId, seen.current);
      setUnseen((current) => (id ? current.filter((x) => x !== id) : []));
    },
    [memberId, unseen],
  );

  const pending = unseen.flatMap((id) => {
    const card = cards.find((c) => c.id === id);
    return card ? [card] : [];
  });

  const isUnseen = useCallback((id: string) => unseen.includes(id), [unseen]);

  return { pending, dismiss, isUnseen };
}
