'use client';

// 組織図。ここにカードをドロップして担当を決める。
import { useLayoutEffect, useRef, useState } from 'react';
import { Sprite } from '@/components/Sprite';
import type { Board, Member } from '@/lib/domain';
import {
  DAY_MINUTES, MEMBERS, assignedMinutes, assistantsOf, cardText, hoursText,
  avatarOf, isOwner, openHelpRequests, orgLevels, runningCards, yen,
} from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

export function OrgChart({
  board, onDropCard,
}: { board: Board; onDropCard: (cardId: string, memberId: string) => void }) {
  const { t, lang } = useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [walking, setWalking] = useState<string | null>(null);

  // 親子を線でつなぐ（描いたあとに実測する）
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const next: string[] = [];
      MEMBERS.filter((m) => m.manager).forEach((m) => {
        const a = el.querySelector<HTMLElement>('[data-node="' + m.manager + '"]');
        const b = el.querySelector<HTMLElement>('[data-node="' + m.id + '"]');
        if (!a || !b) return;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = ra.right - base.left;
        const y1 = ra.top - base.top + ra.height / 2;
        const x2 = rb.left - base.left;
        const y2 = rb.top - base.top + rb.height / 2;
        const mid = (x1 + x2) / 2;
        next.push('M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2);
      });
      setPaths(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [board.cards]);

  const renderNode = (m: Member) => {
    const running = runningCards(board, m.id);
    const mins = assignedMinutes(board, m.id);
    const ratio = mins / DAY_MINUTES;
    const help = openHelpRequests(board).find((c) => c.help?.by === m.id);
    const held = board.cards.filter((c) => isOwner(c, m.id) && !['done', 'rejected'].includes(c.status));

    return (
      <div
        key={m.id}
        data-node={m.id}
        className={['node', running.length ? 'busy' : '', help ? 'helping' : '', over === m.id ? 'drop' : ''].join(' ')}
        onDragOver={(e) => { e.preventDefault(); setOver(m.id); }}
        onDragLeave={() => setOver((v) => (v === m.id ? null : v))}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const cardId = e.dataTransfer.getData('text/card');
          if (!cardId) return;
          setWalking(m.id);
          setTimeout(() => setWalking(null), 900);
          onDropCard(cardId, m.id);
        }}
      >
        {help && <div className="beacon">!</div>}

        <div className="hd">
          <Sprite m={m} size={32} walk={walking === m.id} avatar={avatarOf(board, m)} />
          <div style={{ minWidth: 0 }}>
            <div className="ttl">{localName(lang, m.title)}</div>
            <div className="nm">{localName(lang, m.name)}</div>
          </div>
        </div>

        <div className="cap">
          <div className="bar">
            <i
              className={ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : ''}
              style={{ width: Math.min(100, ratio * 100) + '%' }}
            />
          </div>
          <div className={'num' + (ratio > 1 ? ' over' : '')}>{hoursText(mins)}/8h</div>
        </div>

        <div className="st">
          {running.length ? (
            <span className="chip gold">{t('leader.startedN')} {running.length}</span>
          ) : (
            <span className="chip">{t('leader.waiting')}</span>
          )}
          {help && <span className="chip red">{t('leader.helpWaiting')}</span>}
        </div>

        <div className="node-cards">
          {held.length ? (
            held.map((c) => (
              <div key={c.id} className={'mini' + (c.status === 'running' ? ' run' : '')} title={cardText(c, lang, t).title}>
                <span className="dot" />
                <span className="t">{cardText(c, lang, t).title}</span>
                {assistantsOf(c).length > 0 && (
                  <span className="m" style={{ color: 'var(--blue)' }}>+{assistantsOf(c).length}</span>
                )}
                <span className="m">{c.estMin}{t('common.minutes')}</span>
              </div>
            ))
          ) : (
            <div className="mini empty">{t('leader.noCards')}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="org" ref={wrapRef}>
      <svg className="org-svg">
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#2b3549" strokeWidth="2" />
        ))}
      </svg>
      {orgLevels().map((level, i) => (
        <div className="org-level" key={i}>{level.map(renderNode)}</div>
      ))}
    </div>
  );
}
