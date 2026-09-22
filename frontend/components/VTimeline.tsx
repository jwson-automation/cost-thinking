'use client';

// 縦のタイムライン。時間が上から下、メンバーが列。
import { Sprite } from '@/components/Sprite';
import type { Board } from '@/lib/domain';
import { LUNCH, MEMBERS, WORK_END, WORK_START, avatarOf, cardText, costOf, hhmm, hourFraction, involves, yen } from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

export function VTimeline({ board, now, only }: { board: Board; now: number; only?: string }) {
  const { t, lang } = useLang();
  // only を渡すとその人の列だけ。自分の画面では他人の予定まで要らない。
  const members = only ? MEMBERS.filter((m) => m.id === only) : MEMBERS;
  const hours = WORK_END - WORK_START;
  const nowH = hourFraction(now);
  const pct = (h: number) => ((h - WORK_START) / hours) * 100;

  return (
    <div className="tl" style={{ '--cols': members.length } as React.CSSProperties}>
      <div className="vtl-head">
        <div className="corner" />
        {members.map((m) => (
          <div className="col-head" key={m.id}>
            <Sprite m={m} size={32} avatar={avatarOf(board, m)} />
            <span>{localName(lang, m.name)}</span>
          </div>
        ))}
      </div>

      <div className="vtl-body">
        <div className="vtl-hours">
          {Array.from({ length: hours + 1 }, (_, i) => (
            <div className="hr" key={i} style={{ top: (i / hours) * 100 + '%' }}>
              {WORK_START + i}:00
            </div>
          ))}
        </div>

        {members.map((m) => {
          const items = board.cards.filter((c) => involves(c, m.id) && c.startedAt);
          const cols: number[] = [];
          const blocks = items.map((c) => {
            const startH = hourFraction(c.startedAt as number);
            const endH = c.finishedAt ? hourFraction(c.finishedAt) : nowH;
            const sH = Math.max(WORK_START, Math.min(WORK_END, startH));
            const eH = Math.max(sH, Math.min(WORK_END, endH));
            const top = pct(sH);
            const height = Math.max(2.4, pct(eH) - pct(sH));
            let slot = cols.findIndex((x) => x <= top);
            if (slot === -1) {
              cols.push(top + height);
              slot = cols.length - 1;
            } else {
              cols[slot] = top + height;
            }
            const cls = c.help && !c.help.resolvedAt ? 'help' : c.finishedAt ? 'done' : 'running';
            return { c, top, height, slot, cls, cut: startH < WORK_START };
          });
          const n = Math.max(1, cols.length);

          return (
            <div className="vtl-lane" key={m.id}>
              {Array.from({ length: hours - 1 }, (_, i) => (
                <div className="hline" key={i} style={{ top: ((i + 1) / hours) * 100 + '%' }} />
              ))}
              <div
                className="lunch"
                style={{ top: pct(LUNCH[0]) + '%', height: pct(LUNCH[1]) - pct(LUNCH[0]) + '%' }}
              />
              {blocks.map((b) => (
                <div
                  key={b.c.id}
                  className={['vblock', b.cls, b.cut ? 'cut' : ''].join(' ')}
                  style={{
                    top: b.top + '%',
                    height: b.height + '%',
                    left: (b.slot * 100) / n + '%',
                    width: 'calc(' + 100 / n + '% - 3px)',
                  }}
                  title={
                    b.c.title + ' / ' + yen(costOf(b.c)) + ' / ' + hhmm(b.c.startedAt as number) +
                    (b.c.finishedAt ? ' → ' + hhmm(b.c.finishedAt) : ' 〜')
                  }
                >
                  <b>{hhmm(b.c.startedAt as number)}</b>
                  <span>{cardText(b.c, lang, t).title}</span>
                </div>
              ))}
            </div>
          );
        })}

        {nowH >= WORK_START && nowH <= WORK_END && <div className="nowline" style={{ top: pct(nowH) + '%' }} />}
      </div>
    </div>
  );
}
