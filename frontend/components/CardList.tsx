'use client';

import { useState } from 'react';
import { CardContent } from '@/components/CardContent';
import { Sprite } from '@/components/Sprite';
import type { Board, CardStatus } from '@/lib/domain';
import { avatarOf, cardText, memberOf } from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

const STATES: ('all' | CardStatus)[] = ['all', 'running', 'inbox', 'keep', 'done', 'rejected', 'unassigned'];

export function CardList({ board, now, onOpen }: { board: Board; onOpen?: (cardId: string) => void; now: number }) {
  const { t, lang } = useLang();
  const [filter, setFilter] = useState<'all' | CardStatus>('all');
  const pick = (key: 'all' | CardStatus) =>
    key === 'all' ? board.cards : board.cards.filter((c) => c.status === key);
  const list = pick(filter)
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return (
    <>
      <div className="card-filters" role="group" aria-label={t('leader.cardList')}>
        {STATES.map((key) => (
          <button
            key={key}
            className={'fchip' + (filter === key ? ' on' : '')}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {t('status.' + key)} <b>{pick(key).length}</b>
          </button>
        ))}
      </div>
      <div id="card-list">
        {list.map((c) => {
          const who = memberOf(c.assignee);
          return (
            <article
              data-card={c.id}
              className={'task-card crow draggable ' + c.status}
              key={c.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/card', c.id)}
              title={t('leader.dragHint')}
              onClick={() => onOpen?.(c.id)}
              role={onOpen ? 'button' : undefined}
              aria-label={onOpen ? cardText(c, lang, t).title : undefined}
              tabIndex={onOpen ? 0 : undefined}
              onKeyDown={(e) => {
                if (!onOpen) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id); }
              }}
            >
              <CardContent card={c} now={now} />
              <div className="card-footer">
                <span className="who">
                  {who ? (
                    <>
                      <Sprite m={who} size={32} avatar={avatarOf(board, who)} />
                      {localName(lang, who.name)}
                    </>
                  ) : (
                    t('status.noAssignee')
                  )}
                </span>
                {who && <span className="muted">{localName(lang, who.title)}</span>}
              </div>
            </article>
          );
        })}
        {!list.length && <div className="empty">{t('leader.listEmpty')}</div>}
      </div>
    </>
  );
}
