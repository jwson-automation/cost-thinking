'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CardContent } from '@/components/CardContent';
import { CardDetail } from '@/components/CardDetail';
import { CardList } from '@/components/CardList';
import { flyCoins } from '@/components/Coins';
import { CreateCardModal } from '@/components/CreateCardModal';
import { OrgChart } from '@/components/OrgChart';
import { Insight, WeekPanel } from '@/components/Panels';
import { Activity, Bank, ConnDot, SettingsButton } from '@/components/Shell';
import { Sprite } from '@/components/Sprite';
import { VTimeline } from '@/components/VTimeline';
import { api, useBoard } from '@/lib/api';
import { MEMBERS, avatarOf, cardText, costOf, hasWorked, loadRatio, memberOf, openHelpRequests, spentMinutes, totalSaved, yen } from '@/lib/domain';
import { localName, localeOf, useLang } from '@/lib/i18n';

// リーダー画面はマネージャーとして見ている。メモの書き手もこの人になる。
const LEADER = MEMBERS.find((m) => !m.manager);

export default function LeaderPage() {
  const { t, lang } = useLang();
  const { board, online, refresh } = useBoard();
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // 誰かが見積もりより早く終えたら、チームの貯金箱にもコインが入る
  const savedBefore = useRef<number | null>(null);
  useEffect(() => {
    const total = totalSaved(board);
    if (savedBefore.current === null) {
      savedBefore.current = total;
      return;
    }
    if (total > savedBefore.current) {
      const delta = total - savedBefore.current;
      const bank = document.getElementById('bank');
      const latest = board.savings.filter((s) => s.kind === 'saved').sort((a, b) => b.at - a.at)[0];
      const from =
        (latest && document.querySelector(`[data-card="${latest.cardId}"]`)) ||
        document.querySelector('.board-main');
      if (bank && from) flyCoins(from as HTMLElement, bank, delta);
    }
    savedBefore.current = total;
  }, [board]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const spend = useMemo(
    () =>
      board.cards
        .filter((c) => hasWorked(c))
        .reduce(
          (sum, c) =>
            sum + costOf({ ...c, estMin: spentMinutes(c, now) }, now),
          0,
        ),
    [board.cards, now],
  );
  const avgLoad = MEMBERS.reduce((sum, m) => sum + loadRatio(board, m.id), 0) / MEMBERS.length;
  const pool = board.cards.filter((c) => c.status === 'unassigned');
  const helps = openHelpRequests(board);
  const assign = async (cardId: string, memberId: string) => {
    if (assigning) return;
    setAssigning(cardId);
    setError('');
    try {
      const card = board.cards.find((c) => c.id === cardId);
      await api.move(board, cardId, memberId, card?.assignee ? 'delegate' : 'assign', card?.assignee);
      await refresh();
    } catch {
      setError(t('common.saveFailed'));
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="brand">
          <span className="brand-mark">Cost.</span>
          <b>{t('app.name')}</b>
        </Link>
        <nav className="page-nav" aria-label={t('nav.views')}>
          <Link href="/leader" aria-current="page">
            {t('nav.board')}
          </Link>
          <Link href="/member">{t('nav.myWork')}</Link>
        </nav>
        <div className="spacer" />
        <ConnDot online={online} />
        <SettingsButton>
          <div className="set-row">
            <div className="lb">
              {t('leader.resetTitle')}
              <small>{t('leader.resetHint')}</small>
            </div>
            <button
              className="btn sm danger"
              onClick={async () => {
                if (!confirm(t('leader.resetConfirm'))) return;
                await api.reset();
                await api.seed();
                await refresh();
              }}
            >
              {t('leader.reset')}
            </button>
          </div>
        </SettingsButton>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="date">
              {new Date(now).toLocaleDateString(localeOf(lang), {
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              })}
            </p>
            <h1>{t('nav.board')}</h1>
            <p className="page-description">{t('leader.overview')}</p>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            {t('leader.newCard')}
          </button>
        </div>
        <section className="overview" aria-label={t('leader.overview')}>
          <Bank total={totalSaved(board)} label={t('bank.total')} savings={board.savings} />
          <div className="stat">
            <span>{t('leader.spend')}</span>
            <b className="mono">{yen(spend)}</b>
            <small>{t('leader.spendHint')}</small>
          </div>
          <div className="stat">
            <span>{t('leader.load')}</span>
            <b className="mono">
              {Math.round(avgLoad * 100)}
              <em>%</em>
            </b>
            <small>{t('leader.capacityHint')}</small>
          </div>
          <div className="stat">
            <span>{t('status.running')}</span>
            <b className="mono">
              {board.cards.filter((c) => c.status === 'running').length}
              <em>{t('common.count')}</em>
            </b>
            <small className={helps.length ? 'attention' : ''}>
              {t('leader.helpWaiting')} {helps.length}
              {t('common.count')}
            </small>
          </div>
        </section>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {helps.length > 0 && (
          <div className="help-requests">
            {helps.map((c) => {
              const by = memberOf(c.help?.by);
              return (
                by && (
                  <div className="help-banner" key={c.id}>
                    <Sprite m={by} size={32} avatar={avatarOf(board, by)} />
                    <div className="txt">
                      <b>
                        {localName(lang, by.name)} · {t('help.request')}
                      </b>
                      <p>
                        {cardText(c, lang, t).title}: {c.help?.reason}
                      </p>
                    </div>
                  </div>
                )
              );
            })}
          </div>
        )}
        <div className="leader-grid">
          <div className="board-main">
            <section className="panel team-panel">
              <div className="panel-h">
                <h2>{t('leader.org')}</h2>
                <span className="section-note">{t('leader.orgHint')}</span>
              </div>
              <div className="panel-b" id="view-org">
                <OrgChart board={board} onDropCard={assign} />
              </div>
            </section>

            <section className="work-section">
              <div className="section-heading">
                <h2>
                  {t('leader.cardList')} <span className="count">{board.cards.length}</span>
                </h2>
                <span className="section-note">{t('leader.cardListHint')}</span>
              </div>
              <CardList board={board} now={now} onOpen={setOpenId} />
            </section>
          </div>

          <aside className="board-aside">
            <section className="panel pool-panel">
              <div className="panel-h">
                <h2>
                  {t('leader.unassigned')} <span className="count">{pool.length}</span>
                </h2>
              </div>
              <div className="panel-b pool-list">
                {pool.map((c) => (
                  <article
                    key={c.id}
                    className="task-card pool-card"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/card', c.id)}
                  >
                    <CardContent card={c} now={now} />
                    <label className="assign-control">
                      <span>{t('card.assign')}</span>
                      <select
                        className="input"
                        value=""
                        disabled={assigning === c.id}
                        onChange={(e) => {
                          if (e.target.value) void assign(c.id, e.target.value);
                        }}
                      >
                        <option value="">{t('card.pickAssignee')}</option>
                        {MEMBERS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {localName(lang, m.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
                {!pool.length && (
                  <div className="empty">
                    {t('leader.poolEmpty')}
                    <small>{t('leader.poolEmptySub')}</small>
                  </div>
                )}
              </div>
            </section>
            <section className="panel">
              <div className="panel-h">
                <h2>{t('leader.insight')}</h2>
              </div>
              <div className="panel-b">
                <Insight board={board} />
              </div>
            </section>
            <details className="panel disclosure-panel">
              <summary>{t('leader.timeline')}</summary>
              <div className="panel-b schedule-body">
                <WeekPanel board={board} now={now} />
                <VTimeline board={board} now={now} />
              </div>
            </details>
            <details className="panel disclosure-panel">
              <summary>{t('leader.activity')}</summary>
              <div className="panel-b">
                <Activity board={board} />
              </div>
            </details>
          </aside>
        </div>
      </main>
      {creating && <CreateCardModal onClose={() => setCreating(false)} onCreated={refresh} />}
      {openId && board.cards.some((c) => c.id === openId) && (
        <CardDetail
          card={board.cards.find((c) => c.id === openId)!}
          board={board}
          me={LEADER?.id}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
