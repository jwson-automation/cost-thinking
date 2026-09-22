'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { OrcaMessage } from './OrcaMessage';
import { cardText, type Card } from '@/lib/domain';
import { useLang } from '@/lib/i18n';

export function CardArrivalDialog({
  cards,
  onDismiss,
  onOpen,
}: {
  cards: Card[];
  onDismiss: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useLang();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    // Wait for settings, creation or card detail to close before taking focus.
    const check = () => setAvailable(!document.querySelector('dialog[open]:not(.orca-arrival)'));
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    check();
    return () => observer.disconnect();
  }, []);

  const card = cards[0];
  if (!available || !card) return null;
  const text = cardText(card, lang);
  return (
    <Dialog title={t('orca.arrived')} onClose={onDismiss} compact className="orca-dialog orca-arrival">
      <OrcaMessage title={t('orca.arrived')} description={t('orca.arrivalHint')}>
        <div className="orca-task">
          <span className="orca-task-label">{t('orca.newTask')}</span>
          <h3>{text.title}</h3>
          {text.summary && <p>{text.summary}</p>}
          <span className="orca-task-time">
            {t('card.estimatedTime')}{' '}
            <b>
              {card.estMin}
              {t('common.minutes')}
            </b>
          </span>
        </div>
        {cards.length > 1 && (
          <p className="orca-queued">{t('orca.moreTasks').replace('{count}', String(cards.length - 1))}</p>
        )}
        <div className="orca-actions">
          <button className="btn primary" onClick={() => onOpen(card.id)}>
            {t('orca.openTask')}
          </button>
          <button className="btn ghost" onClick={onDismiss}>
            {t('orca.later')}
          </button>
        </div>
      </OrcaMessage>
    </Dialog>
  );
}
