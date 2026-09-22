'use client';

// メンバー画面：自分のカードを決めて、応援をやり取りする。
import Link from 'next/link';
import { CardContent } from '@/components/CardContent';
import { useEffect, useRef, useState } from 'react';
import { CardDetail } from '@/components/CardDetail';
import { CardArrivalDialog } from '@/components/CardArrivalDialog';
import { CreateCardModal } from '@/components/CreateCardModal';
import { flyCoins } from '@/components/Coins';
import { Activity, AvatarPicker, Bank, ConnDot, MemberPicker, SettingsButton } from '@/components/Shell';
import { Sprite } from '@/components/Sprite';
import { VTimeline } from '@/components/VTimeline';
import { api, useBoard } from '@/lib/api';
import { useCardArrivals } from '@/lib/useCardArrivals';
import type { Card } from '@/lib/domain';
import {
  DAY_MINUTES,
  MEMBERS,
  PRIORITY,
  assignedMinutes,
  assistCostOf,
  avatarOf,
  cardText,
  elapsed,
  hhmm,
  hoursText,
  isAssisting,
  involves,
  managerOf,
  memberOf,
  savedByOf,
  mySpentMinutes,
  myState,
  isShared,
  spentMinutes,
  hasWorked,
  TEAM_RATE,
  openHelpRequests,
  runningCards,
  subordinates,
  yen,
} from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

export default function MemberPage() {
  const { t, lang } = useLang();
  const { board, online, ready, refresh } = useBoard();
  const [meId, setMeId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const arrivals = useCardArrivals(board.cards, meId, ready);
  const bankRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('ct-me');
    if (saved && memberOf(saved)) setMeId(saved);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const me = memberOf(meId ?? undefined);

  // カードのどこかを押したら詳細を開く。ボタンの上は本来の動作を優先。
  const openCard = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
    setOpenId(id);
  };

  const pick = (id: string) => {
    localStorage.setItem('ct-me', id);
    setMeId(id);
  };

  if (!me) {
    return (
      <div className="login">
        <div className="login-box">
          <div className="brand" style={{ padding: '0 0 6px' }}>
            <div className="brand-mark">Cost.</div>
            <div>
              <b className="px">{t('app.name')}</b>
              <small>{t('nav.member')}</small>
            </div>
          </div>
          <h1>{t('member.pick')}</h1>
          <div className="who-grid">
            {MEMBERS.map((m) => (
              <button className="who-card" key={m.id} onClick={() => pick(m.id)}>
                <Sprite m={m} size={64} avatar={avatarOf(board, m)} />
                <div className="t">{localName(lang, m.title)}</div>
                <b>{localName(lang, m.name)}</b>
                <span>{localName(lang, m.role)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 会議・共同業務は担当でなくても自分のカード
  const mine = board.cards.filter((c) => involves(c, me.id) && c.status !== 'rejected');
  const open = mine.filter((c) => myState(c, me.id) !== 'done');
  const done = mine.filter((c) => myState(c, me.id) === 'done');
  const assists = board.cards.filter(
    (c) => isAssisting(c, me.id) && !['done', 'rejected'].includes(c.status),
  );
  const mins = assignedMinutes(board, me.id);
  const ratio = mins / DAY_MINUTES;
  const mySavings = board.savings.filter((s) =>
    board.cards.some((c) => c.id === s.cardId && involves(c, me.id)),
  );
  const myTotal = mySavings.filter((s) => s.kind === 'saved').reduce((a, b) => a + b.amount, 0);
  const hour = new Date(now).getHours();

  const act = async (c: Card, action: string, node: HTMLElement) => {
    // 会議・共同業務は参加者ひとりずつが自分の手で動かす
    const shared = isShared(c);
    switch (action) {
      case 'start':
        if (shared) {
          await api.progress(c.id, me.id, 'start', `${me.name} が「${c.title}」に着手しました`);
        } else {
          await api.status(c.id, 'running', { text: `${me.name} が「${c.title}」に着手しました` });
        }
        break;
      case 'keep':
        if (shared) {
          await api.progress(c.id, me.id, 'keep', `${me.name} が「${c.title}」を保留にしました`);
        } else {
          await api.status(c.id, 'keep', { text: `${me.name} が「${c.title}」を保留にしました` });
        }
        break;
      case 'reject': {
        const why = prompt(t('act.rejectReasonQ'), t('act.rejectReasonDefault'));
        if (why === null) return;
        await api.status(c.id, 'rejected', {
          reason: why,
          text: `${me.name} が「${c.title}」を差し戻し：${why}`,
        });
        break;
      }
      case 'help': {
        const why = prompt(t('act.helpReasonQ'), t('act.helpReasonDefault'));
        if (why === null) return;
        await api.requestHelp(board, c.id, me.id, why);
        break;
      }
      case 'resolve': {
        const helpers = c.help?.helpers ?? [];
        const savedMin = c.help?.minutes ?? 30;
        // 応援で避けられた手戻り。関わった人数ぶんの半分を貯金にする。
        const heads = helpers.length + 1;
        const amount = Math.round((TEAM_RATE * heads * (savedMin / 60)) / 2);
        await api.resolveHelp(board, c.id, me.id, amount);
        await api.saving(c.id, `応援で解決（${savedMin}分の手戻りを回避）`, amount);
        if (bankRef.current) flyCoins(node, bankRef.current, amount);
        break;
      }
      case 'delegate': {
        const subs = subordinates(me.id);
        if (!subs.length) {
          alert(t('act.noSubordinate'));
          return;
        }
        const labels = subs
          .map(
            (s, i) => `${i + 1}. ${localName(lang, s.name)}（${hoursText(assignedMinutes(board, s.id))}/8h）`,
          )
          .join('\n');
        const v = prompt(`${t('act.delegateQ')}\n${labels}`, '1');
        const idx = Number(v) - 1;
        if (!subs[idx]) return;
        await api.move(board, c.id, subs[idx].id, 'delegate', me.id);
        break;
      }
      case 'escalate': {
        const boss = managerOf(me.id);
        if (!boss) return;
        await api.move(board, c.id, boss.id, 'escalate', me.id);
        break;
      }
      case 'done': {
        const actualMin = mySpentMinutes(c, me.id);
        const amount = savedByOf(c, me.id);
        if (shared) {
          await api.progress(c.id, me.id, 'done', `${me.name} が「${c.title}」を完了しました`);
        } else {
          await api.status(c.id, 'done', { text: `${me.name} が「${c.title}」を完了しました` });
        }
        if (amount > 0) {
          await api.saving(
            c.id,
            `${c.title}（見積 ${c.estMin}分 → 実績 ${Math.round(actualMin)}分）`,
            amount,
          );
          if (bankRef.current) flyCoins(node, bankRef.current, amount);
        } else {
          alert(t('act.overEstimate'));
        }
        break;
      }
    }
    await refresh();
  };

  return (
    <div className="app member">
      <div className="main">
        <header className="top">
          <Link href="/" className="brand">
            <span className="brand-mark">Cost.</span>
          </Link>
          <nav className="page-nav" aria-label={t('nav.views')}>
            <Link href="/leader">{t('nav.board')}</Link>
            <Link href="/member" aria-current="page">
              {t('nav.myWork')}
            </Link>
          </nav>
          <Sprite m={me} size={32} avatar={avatarOf(board, me)} />
          <h1>{localName(lang, me.name)}</h1>
          <span className="date">
            {localName(lang, me.title)}
            {managerOf(me.id)
              ? ` · ${t('member.manager')} ${localName(lang, managerOf(me.id)!.name)}`
              : ''}
          </span>

          <div className="daybar">
            <div style={{ fontSize: 10, color: 'var(--dim)' }}>{t('member.load')}</div>
            <div className="cap">
              <div className="bar">
                <i
                  className={ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : ''}
                  style={{ width: Math.min(100, ratio * 100) + '%' }}
                />
              </div>
              <div className={'num' + (ratio > 1 ? ' over' : '')}>{hoursText(mins)}/8h</div>
            </div>
          </div>

          <div className="spacer" style={{ flex: 1 }} />
          <div className="stat">
            <span>{t('member.started')}</span>
            <b className="acc mono">
              {mine.filter((c) => myState(c, me.id) !== 'idle').length}
              {t('common.count')}
            </b>
          </div>
          <div className="stat">
            <span>{t('member.done')}</span>
            <b className="mono">
              {done.length}
              {t('common.count')}
            </b>
          </div>

          <div ref={bankRef}>
            <Bank total={myTotal} label={t('bank.mine')} savings={mySavings} />
          </div>
          <ConnDot online={online} />
          <SettingsButton>
            <AvatarPicker me={me} board={board} onPick={async (a) => { await api.avatar(me.id, a); await refresh(); }} />
            <MemberPicker me={me} board={board} onPick={pick} />
          </SettingsButton>
        </header>

        <main className="member-page">
          {/* カード */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="day-banner">
              <Sprite m={me} size={32} avatar={avatarOf(board, me)} />
              <div>
                <b>
                  {t(
                    hour < 11 ? 'member.greetMorning' : hour < 17 ? 'member.greetDay' : 'member.greetEvening',
                  )}
                </b>
                <p>
                  {ratio > 1
                    ? t('member.over')
                    : hoursText(Math.max(0, DAY_MINUTES - mins)) + t('member.slack')}
                </p>
              </div>
              <div className="spacer" style={{ flex: 1 }} />
              <span className="chip gold">
                {open.length}
                {t('common.cards')}
              </span>
            </div>

            <section className="work-section">
              <div className="section-heading">
                <h2>{t('member.todayCards')}</h2>
                <div className="spacer" style={{ flex: 1 }} />
                <span className="count">{open.length}</span>
                <button className="btn primary sm" onClick={() => setCreating(true)}>
                  {t('member.newCard2')}
                </button>
              </div>

              <div className="member-cards">
                {!open.length && !done.length && (
                  <div className="empty">
                    {t('member.empty')}
                    <br />
                    {t('member.emptySub')}
                  </div>
                )}
                {!open.length && done.length > 0 && <div className="empty">{t('member.allDone')}</div>}

                {open
                  .slice()
                  .sort((a, b) => Number(myState(b, me.id) === 'running') - Number(myState(a, me.id) === 'running'))
                  .map((c, i) => {
                    const running = myState(c, me.id) === 'running';
                    const help = c.help && !c.help.resolvedAt ? c.help : null;
                    const progress = running
                      ? Math.min(160, (mySpentMinutes(c, me.id, now) / c.estMin) * 100)
                      : 0;
                    const isNew = arrivals.pending.some(card => card.id === c.id);

                    return (
                      <div
                        className={['deal-card', 'crow', PRIORITY[c.priority].cls, isNew ? 'arrive' : ''].join(' ')}
                        key={c.id}
                        style={isNew ? { animationDelay: i * 90 + 'ms' } : undefined}
                        role="button"
                        aria-label={cardText(c, lang, t).title}
                        tabIndex={0}
                        onClick={(e) => openCard(e, c.id)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            setOpenId(c.id);
                          }
                        }}
                      >
                        {isNew && <div className="arrive-badge">{t('member.new')}</div>}

                        {running && (
                          <div className="running-strip">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/assets/ui/coin-01.png" alt="" style={{ width: 20, height: 20 }} />
                            <div>
                              {t('member.startedAt')} {hhmm(c.progress?.[me.id]?.startedAt ?? (c.startedAt as number))}
                            </div>
                            <div className="spacer" style={{ flex: 1 }} />
                            <div className="t mono">{elapsed(mySpentMinutes(c, me.id, now) * 60000)}</div>
                          </div>
                        )}

                        {help && (
                          <div className="help-banner">
                            <div className="txt">
                              <b>{t('help.requesting')}</b> — {help.reason}
                              {help.helpers.length > 0 &&
                                ' / ' +
                                  help.helpers
                                    .map((id) => localName(lang, memberOf(id)?.name ?? ''))
                                    .join(', ')}
                            </div>
                          </div>
                        )}

                        <CardContent card={c} now={now} />

                        {running && (
                          <>
                            <div className="prog">
                              <i
                                className={progress > 100 ? 'over' : ''}
                                style={{ width: Math.min(100, progress) + '%' }}
                              />
                            </div>
                            <div className="progress-label">
                              {t('member.progressOf')} {Math.round(progress)}%
                            </div>
                          </>
                        )}

                        <div className="acts">
                          {running ? (
                            <>
                              <button
                                className="btn primary"
                                onClick={(e) =>
                                  act(c, 'done', e.currentTarget.closest('.deal-card') as HTMLElement)
                                }
                              >
                                {t('act.done')}
                              </button>
                              {help ? (
                                <button
                                  className="btn sm"
                                  onClick={(e) =>
                                    act(c, 'resolve', e.currentTarget.closest('.deal-card') as HTMLElement)
                                  }
                                >
                                  {t('act.resolve')}
                                </button>
                              ) : (
                                <button
                                  className="btn danger sm pulse"
                                  onClick={(e) => act(c, 'help', e.currentTarget)}
                                >
                                  {t('act.help')}
                                </button>
                              )}
                              <button className="btn sm" onClick={(e) => act(c, 'keep', e.currentTarget)}>
                                {t('act.keepRunning')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn primary"
                                onClick={(e) => act(c, 'start', e.currentTarget)}
                              >
                                {t('act.start')}
                              </button>
                              <button className="btn" onClick={(e) => act(c, 'keep', e.currentTarget)}>
                                {t('act.keep')}
                              </button>
                              <button
                                className="btn danger"
                                onClick={(e) => act(c, 'reject', e.currentTarget)}
                              >
                                {t('act.reject')}
                              </button>
                            </>
                          )}
                          {subordinates(me.id).length > 0 && (
                            <button className="btn sm" onClick={(e) => act(c, 'delegate', e.currentTarget)}>
                              {t('act.delegate')}
                            </button>
                          )}
                          {managerOf(me.id) && (
                            <button className="btn sm" onClick={(e) => act(c, 'escalate', e.currentTarget)}>
                              {localName(lang, managerOf(me.id)!.name)}
                              {t('act.escalate')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {assists.length > 0 && (
                  <>
                    <div className="sec-title">
                      {t('assist.title')} {assists.length}
                      {t('common.count')}
                    </div>
                    {assists.map((c) => {
                      const owner = memberOf(c.assignee);
                      return (
                        <div
                          className="deal-card assist-card crow"
                          key={c.id}
                          role="button"
                          aria-label={cardText(c, lang, t).title}
                          tabIndex={0}
                          onClick={(e) => openCard(e, c.id)}
                          onKeyDown={(e) => {
                            if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              setOpenId(c.id);
                            }
                          }}
                        >
                          <div className="card-inline">
                            <span className="role-badge assist">{t('assist.badge')}</span>
                            {owner && <Sprite m={owner} size={32} avatar={avatarOf(board, owner)} />}
                            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                              {owner ? localName(lang, owner.name) : ''}
                              {t('assist.ownerOf')}
                            </span>
                            <div className="spacer" style={{ flex: 1 }} />
                          </div>
                          <CardContent card={c} now={now} />
                          <div className="assist-note">
                            {t('assist.mine')} {yen(assistCostOf(c, me.id, now))}（
                            {hhmm(c.assist?.[me.id]?.joinedAt ?? now)}〜）
                          </div>
                          <div className="acts">
                            <button
                              className="btn sm"
                              onClick={async () => {
                                await api.leave(board, c.id, me.id);
                                await refresh();
                              }}
                            >
                              {t('assist.leave')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {done.length > 0 && (
                  <>
                    <div className="sec-title">
                      {t('member.doneToday')} {done.length}
                      {t('common.count')}
                    </div>
                    {done.map((c) => (
                      <div
                        className="deal-card completed-card crow"
                        key={c.id}
                        role="button"
                        aria-label={cardText(c, lang, t).title}
                        tabIndex={0}
                        onClick={(e) => openCard(e, c.id)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            setOpenId(c.id);
                          }
                        }}
                      >
                        <CardContent card={c} now={now} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>

          {/* チーム */}
          <aside className="panel col-team">
            <div className="panel-h">
              <h2>{t('team.status')}</h2>
              <div className="spacer" style={{ flex: 1 }} />
              <span className="chip">
                {t('team.load')}{' '}
                {Math.round(
                  (MEMBERS.reduce((s, m) => s + assignedMinutes(board, m.id) / DAY_MINUTES, 0) /
                    MEMBERS.length) *
                    100,
                )}
                %
              </span>
            </div>

            <div className="panel-b">
              {openHelpRequests(board)
                .filter((c) => c.help?.by !== me.id)
                .map((c) => {
                  const by = memberOf(c.help?.by);
                  const joined = isAssisting(c, me.id);
                  if (!by) return null;
                  return (
                    <div className="help-banner" key={c.id}>
                      <Sprite m={by} size={32} avatar={avatarOf(board, by)} />
                      <div className="txt">
                        <b>
                          {localName(lang, by.name)} {t('help.request')}
                        </b>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>
                          {cardText(c, lang, t).title}：{c.help?.reason}
                        </span>
                      </div>
                      <div className="spacer" style={{ flex: 1 }} />
                      <button
                        className={'btn sm' + (joined ? '' : ' pulse')}
                        disabled={joined}
                        onClick={async () => {
                          await api.offerHelp(board, c.id, me.id);
                          await refresh();
                        }}
                      >
                        {joined ? t('assist.badge') : t('assist.join')}
                      </button>
                    </div>
                  );
                })}

              {MEMBERS.filter((m) => m.id !== me.id).map((m) => {
                const run = runningCards(board, m.id);
                const mMins = assignedMinutes(board, m.id);
                const r = mMins / DAY_MINUTES;
                const isHelp = openHelpRequests(board).some((c) => c.help?.by === m.id);
                const target = run[0];
                const joined = target ? isAssisting(target, me.id) : false;
                return (
                  <div
                    className={['team-row', run.length ? 'is-running' : '', isHelp ? 'is-help' : ''].join(
                      ' ',
                    )}
                    key={m.id}
                  >
                    <Sprite m={m} size={32} avatar={avatarOf(board, m)} />
                    <div>
                      <div className="n">
                        {localName(lang, m.name)}{' '}
                        <span style={{ color: 'var(--dim)', fontSize: 10 }}>{localName(lang, m.title)}</span>
                      </div>
                      <div className="s">
                        {isHelp
                          ? t('team.helpNow')
                          : run.length
                            ? t('team.workingOn') + run[0].title
                            : t('leader.waiting')}
                      </div>
                      <div className="cap">
                        <div className="bar">
                          <i
                            className={r > 1 ? 'over' : r > 0.85 ? 'warn' : ''}
                            style={{ width: Math.min(100, r * 100) + '%' }}
                          />
                        </div>
                        <div className="num">{hoursText(mMins)}</div>
                      </div>
                    </div>
                    {target ? (
                      <button
                        className="btn sm"
                        onClick={async () => {
                          if (joined) await api.leave(board, target.id, me.id);
                          else await api.join(board, target.id, me.id);
                          await refresh();
                        }}
                      >
                        {joined ? t('assist.leave') : t('assist.join')}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>

            <details className="disclosure-panel">
              <summary>{t('leader.activity')}</summary>
              <div className="panel-b">
                <Activity board={board} />
              </div>
            </details>

            {/* 自分の一日だけ。他の人の予定は team の列で見る。 */}
            <details className="disclosure-panel">
              <summary>{t('leader.timeline')}</summary>
              <div className="panel-b">
                <VTimeline board={board} now={now} only={me.id} />
              </div>
            </details>
          </aside>
        </main>
      </div>

      {creating && <CreateCardModal onClose={() => setCreating(false)} onCreated={refresh} />}

      {!creating && !openId && arrivals.pending.length > 0 && (
        <CardArrivalDialog
          cards={arrivals.pending}
          onDismiss={() => arrivals.dismiss()}
          onOpen={(id) => {
            arrivals.dismiss(id);
            setOpenId(id);
          }}
        />
      )}

      {openId && board.cards.some((c) => c.id === openId) && (
        <CardDetail
          card={board.cards.find((c) => c.id === openId)!}
          board={board}
          me={me.id}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
