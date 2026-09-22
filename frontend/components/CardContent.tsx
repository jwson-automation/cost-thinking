'use client';

import type { Card } from '@/lib/domain';
import { PRIORITY, assistantsOf, cardText, costOf, doneCountOf, hasWorked, headcountOf, hhmm, isBreak, isShared, kindOf, spentMinutes, yen, yenFromUsd } from '@/lib/domain';
import { useLang } from '@/lib/i18n';

const statusColor: Record<Card['status'], string> = {
  running: 'blue',
  inbox: '',
  keep: 'gold',
  done: 'acc',
  rejected: 'red',
  unassigned: '',
};

/** The same information hierarchy in the pool, board, and personal inbox. */
export function CardContent({ card, now = Date.now() }: { card: Card; now?: number }) {
  const { t, lang } = useLang();
  const text = cardText(card, lang, t);
  const done = doneCountOf(card);
  const spent = spentMinutes(card, now);
  return (
    <>
      <div className="card-labels">
        <span className={'chip ' + statusColor[card.status]}>{t('status.' + card.status)}</span>
        {kindOf(card) !== 'task' && <span className="chip kind">{t('kind.' + kindOf(card))}</span>}
        {isShared(card) && (
          <span className="chip">
            {done.total ? `${done.done}/${done.total}` : headcountOf(card)}
            {done.total ? ' ' + t('card.doneCount') : t('common.people')}
          </span>
        )}
        {card.startAt && !card.started ? (
          <span className="chip blue">{hhmm(card.startAt)} {t('card.scheduled')}</span>
        ) : null}
        {text.pending && <span className="chip">{t('card.translating')}</span>}
        {card.priority === 'high' && !isBreak(card) && <span className="priority-high">{t(PRIORITY.high.key)}</span>}
        {card.help && !card.help.resolvedAt && <span className="chip red">{t('leader.helpWaiting')}</span>}
      </div>
      <h3 className="task-title">{text.title}</h3>
      {text.summary && <p className="task-summary">{text.summary}</p>}
      <dl className="card-metrics">
        <div>
          <dt>{t('card.estimatedTime')}</dt>
          <dd>
            {card.estMin}
            <small>{t('common.minutes')}</small>
          </dd>
        </div>
        <div>
          <dt>{t('card.estimatedCost')}</dt>
          <dd>{isBreak(card) ? t('card.free') : yen(costOf(card, now))}</dd>
        </div>
      </dl>
      <details className="card-details">
        <summary>
          {t('card.details')}
          {text.checklist.length > 0 && <span>{text.checklist.length}</span>}
        </summary>
        <div className="detail-meta">
          <span>
            {t('modal.priority')} {t(PRIORITY[card.priority].key)}
          </span>
          {hasWorked(card) ? (
            <span>
              {t('card.actual')} {spent}
              {t('common.minutes')}
              {card.startedAt ? ` (${hhmm(card.startedAt)}–${card.finishedAt ? hhmm(card.finishedAt) : ''})` : ''}
            </span>
          ) : null}
          {assistantsOf(card).length > 0 && (
            <span>
              {t('card.assist')} {assistantsOf(card).length}
              {t('common.people')}
            </span>
          )}
          {card.aiModel && (
            <span>
              {t('card.aiCost')} {yenFromUsd(card.aiCostUsd)}
            </span>
          )}
        </div>
        <ul className="check">
          {text.checklist.map((item, i) => (
            <li key={i} className={card.checked?.[i] ? 'done' : ''}>{item}</li>
          ))}
        </ul>
        {card.materials && <p className="task-materials">{card.materials}</p>}
      </details>
      {card.status === 'rejected' && card.rejectReason && (
        <p className="reason">
          {t('card.rejectReason')}: {card.rejectReason}
        </p>
      )}
    </>
  );
}
