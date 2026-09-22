'use client';

// 週カレンダーとチームインサイト。どちらも「いま偏っていないか」を見るための場所。
import type { Board } from '@/lib/domain';
import { DAY_MINUTES, MEMBERS, assignedMinutes, hasWorked, hoursText, openHelpRequests, runningCards, totalSaved, yen } from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

export function WeekPanel({ board, now }: { board: Board; now: number }) {
  const { t, lang } = useLang();
  const today = new Date(now);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = ['week.mon', 'week.tue', 'week.wed', 'week.thu', 'week.fri', 'week.sat', 'week.sun'].map((k) => t(k));
  const t0 = new Date(today);
  t0.setHours(0, 0, 0, 0);

  const started = board.cards.filter((c) => hasWorked(c)).length;
  const done = board.cards.filter((c) => c.status === 'done').length;
  const running = board.cards.filter((c) => c.status === 'running').length;

  return (
    <div>
      <div className="week">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const isToday = d.toDateString() === today.toDateString();
          const isPast = d < t0;
          const dots = isToday ? Math.min(3, started) : 0;
          return (
            <div className={['day', isToday ? 'on' : '', isPast ? 'past' : ''].join(' ')} key={i}>
              <span className="w">{days[i]}</span>
              <span className="n">{d.getDate()}</span>
              <span className="dots">
                {Array.from({ length: dots }, (_, k) => (
                  <i key={k} className={k < done ? 'done' : ''} />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <div className="week-sum">
        <div><b className="mono">{running}</b><span>{t('week.running')}</span></div>
        <div><b className="mono">{done}</b><span>{t('week.done')}</span></div>
        <div><b className="mono gold">{yen(totalSaved(board))}</b><span>{t('week.saved')}</span></div>
      </div>
    </div>
  );
}

export function Insight({ board }: { board: Board }) {
  const { t, lang } = useLang();
  const rows = MEMBERS.map((m) => {
    const mins = assignedMinutes(board, m.id);
    return {
      m,
      mins,
      ratio: mins / DAY_MINUTES,
      run: runningCards(board, m.id).length,
      help: openHelpRequests(board).some((c) => c.help?.by === m.id),
    };
  });

  const names = (list: typeof rows) => list.map((r) => localName(lang, r.m.name)).join(t('common.listSep'));
  const over = rows.filter((r) => r.ratio > 1);
  const idle = rows.filter((r) => r.ratio < 0.3 && !r.run);
  const helping = rows.filter((r) => r.help);

  const tips: { cls: string; text: string }[] = [];
  if (helping.length) {
    tips.push({ cls: 'red', text: names(helping) + t('insight.waitingHelp') });
  }
  if (over.length) {
    tips.push({
      cls: 'warn',
      text: names(over) + t('insight.over'),
    });
  }
  if (idle.length) {
    tips.push({ cls: '', text: names(idle) + t('insight.idle') });
  }
  if (!tips.length) tips.push({ cls: 'ok', text: t('leader.insightOk') });

  return (
    <>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.m.id} title={localName(lang, r.m.name) + ' ' + hoursText(r.mins) + '/8h'}>
            <span className="nm">{localName(lang, r.m.name)}</span>
            <div className="bar">
              <i
                className={r.ratio > 1 ? 'over' : r.ratio > 0.85 ? 'warn' : ''}
                style={{ width: Math.min(100, r.ratio * 100) + '%' }}
              />
            </div>
            <span className="v mono">{hoursText(r.mins)}</span>
          </div>
        ))}
      </div>
      {tips.map((tip, i) => (
        <div className={'tip ' + tip.cls} key={i}>{tip.text}</div>
      ))}
    </>
  );
}
