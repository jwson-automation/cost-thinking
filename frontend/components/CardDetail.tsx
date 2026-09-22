'use client';

// カードの詳細。左に内容、右にメモ。差し戻されたカードはここで直して戻す。
import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { Sprite } from '@/components/Sprite';
import { api } from '@/lib/api';
import type { Board, Card } from '@/lib/domain';
import {
  MEMBERS, PRIORITY, clockOf, assistantsOf, avatarOf, cardText, costOf, headcountOf, hhmm, isBreak,
  isShared, kindOf, memberOf, memoText, spentMinutes, hasWorked, yen, yenFromUsd,
} from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

type Priority = 'high' | 'mid' | 'low';

export function CardDetail({
  card, board, me, onClose, onChanged,
}: {
  card: Card;
  board: Board;
  me?: string;                       // メモを書く人。リーダー画面では未指定。
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { t, lang } = useLang();
  const text = cardText(card, lang, t);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.summary);
  const [estMin, setEstMin] = useState(String(card.estMin));
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const owner = memberOf(card.assignee);
  const helpers = assistantsOf(card).map((id) => memberOf(id)).filter(Boolean);
  const spent = spentMinutes(card);
  const writer = me ? memberOf(me) : undefined;

  const doneCount = (card.checked ?? []).filter(Boolean).length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch {
      setError(t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  // 時刻だけを受け取り、今日の日付に載せる
  const setTime = (v: string) => {
    if (!v) return run(() => api.schedule(card.id, 0, `「${card.title}」の予約を取り消しました`));
    const [h, m] = v.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return run(() => api.schedule(card.id, d.getTime(), `「${card.title}」を ${v} 開始に設定しました`));
  };

  const toggleCheck = (i: number) =>
    run(() => api.check(card.id, i, !card.checked?.[i]));

  // 一般業務 ⇄ 共同業務。ドラッグしなくても、押すだけで複数人の仕事にできる。
  const switchKind = () =>
    run(() =>
      api.kind({
        cardId: card.id,
        kind: isShared(card) ? 'task' : 'coop',
        text: `「${card.title}」を${isShared(card) ? t('kind.task') : t('kind.coop')}にしました`,
      }),
    );

  // 共同業務・会議は、誰を入れるかをこの場で押して決める
  const toggleMember = (id: string) => {
    const inNow = (card.participants ?? []).includes(id);
    const name = localName(lang, memberOf(id)?.name ?? '');
    return run(() =>
      api.kind({
        cardId: card.id,
        ...(inNow ? { leave: id } : { join: id }),
        text: `${name} を「${card.title}」${inNow ? 'から外しました' : 'に追加しました'}`,
      }),
    );
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.updateCard({
        cardId: card.id,
        title: title.trim() || card.title,
        summary,
        checklist: card.checklist,
        priority,
        estMin: Number(estMin) || card.estMin,
        // 差し戻されたカードは直したら担当の受信箱へ戻す
        status: card.status === 'rejected' ? (card.assignee ? 'inbox' : 'unassigned') : '',
        text:
          card.status === 'rejected'
            ? `${writer?.name ?? ''} が「${title.trim() || card.title}」を直して戻しました`
            : '',
      });
      setEditing(false);
      await onChanged();
    } catch {
      setError(t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const addMemo = async () => {
    if (!memo.trim() || !me) return;
    setBusy(true);
    setError('');
    try {
      await api.comment(card.id, me, memo.trim());
      setMemo('');
      await onChanged();
    } catch {
      setError(t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={text.title} onClose={onClose}>
      <div className="modal-h">
        <span className={'chip ' + (card.status === 'rejected' ? 'red' : card.status === 'running' ? 'blue' : '')}>
          {t('status.' + card.status)}
        </span>
        <h2 className="detail-title">{text.title}</h2>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>

      <div className="modal-b detail-body">
        {error && <p className="error-message" role="alert">{error}</p>}

        {card.status === 'rejected' && card.rejectReason && (
          <div className="reject-box">
            <b>{t('card.rejectReason')}</b>
            <span>{card.rejectReason}</span>
          </div>
        )}

        <div className="detail-grid">
          {/* 左：内容 */}
          <div className="detail-main">
            {editing ? (
              <div className="detail-edit">
                <div className="field">
                  <label htmlFor="d-title">{t('detail.title')}</label>
                  <input id="d-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="d-summary">{t('detail.summary')}</label>
                  <textarea id="d-summary" className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="d-est">{t('card.estimatedTime')}</label>
                    <input
                      id="d-est" className="input" type="number" min={15} step={15}
                      value={estMin} onChange={(e) => setEstMin(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <span className="field-label" id="d-priority-label">{t('modal.priority')}</span>
                    <div className="seg" role="group" aria-labelledby="d-priority-label">
                      {(['high', 'mid', 'low'] as Priority[]).map((p) => (
                        <button key={p} className={priority === p ? 'on' : ''} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                          {t(PRIORITY[p].key)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
                  <button className="btn primary" onClick={save} disabled={busy}>
                    {card.status === 'rejected' ? t('detail.fixAndReturn') : t('detail.save')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {text.summary && <p className="detail-summary">{text.summary}</p>}

                {text.checklist.length > 0 && (
                  <>
                    <h3 className="detail-h">
                      {t('modal.checklist')} <span className="count">{doneCount}/{text.checklist.length}</span>
                      <small>{t('detail.checkHint')}</small>
                    </h3>
                    <ul className="detail-check">
                      {text.checklist.map((x, i) => (
                        <li key={i}>
                          <button
                            className={'check-item' + (card.checked?.[i] ? ' on' : '')}
                            aria-pressed={Boolean(card.checked?.[i])}
                            disabled={busy}
                            onClick={() => toggleCheck(i)}
                          >
                            <span className="box" aria-hidden="true">{card.checked?.[i] ? '✓' : ''}</span>
                            <span>{x}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h3 className="detail-h">{t('detail.info')}</h3>
                <dl className="detail-facts">
                  <div><dt>{t('detail.assignee')}</dt><dd>
                    {owner ? (
                      <span className="detail-person">
                        <Sprite m={owner} size={32} avatar={avatarOf(board, owner)} />
                        {localName(lang, owner.name)}
                      </span>
                    ) : t('status.noAssignee')}
                  </dd></div>
                  <div><dt>{t('kind.label')}</dt><dd>
                    {t('kind.' + kindOf(card))}
                    {card.breakKind ? <small>{t('break.' + card.breakKind)}</small> : null}
                  </dd></div>
                  {isShared(card) && (
                    <div><dt>{t('detail.startAt')}</dt><dd>
                      <span className="detail-person">
                        <input
                          className="input time" type="time" step={300} disabled={busy}
                          value={card.startAt ? clockOf(card.startAt) : ''}
                          onChange={(e) => setTime(e.target.value)}
                        />
                        {card.startAt && !card.started ? <small>{t('card.scheduled')}</small> : null}
                      </span>
                    </dd></div>
                  )}
                  {isShared(card) && (
                    <div><dt>{t('detail.members')}</dt><dd>
                      <div className="member-pick">
                        {MEMBERS.map((m) => {
                          const on = (card.participants ?? []).includes(m.id);
                          return (
                            <button
                              key={m.id}
                              className={on ? 'on' : ''}
                              aria-pressed={on}
                              disabled={busy}
                              onClick={() => toggleMember(m.id)}
                            >
                              <Sprite m={m} size={32} avatar={avatarOf(board, m)} />
                              {localName(lang, m.name)}
                            </button>
                          );
                        })}
                        <small>{headcountOf(card)}{t('common.people')}</small>
                      </div>
                    </dd></div>
                  )}
                  <div><dt>{t('modal.priority')}</dt><dd>{t(PRIORITY[card.priority].key)}</dd></div>
                  {card.complexity && (
                    <div><dt>{t('card.complexity')}</dt><dd>{t('complexity.' + card.complexity)}</dd></div>
                  )}
                  <div><dt>{t('card.estimatedTime')}</dt><dd>{card.estMin}{t('common.minutes')}</dd></div>
                  <div><dt>{t('card.estimatedCost')}</dt><dd>
                    {isBreak(card) ? t('card.free') : yen(costOf(card))}
                  </dd></div>
                  {hasWorked(card) ? (
                    <div><dt>{t('card.actual')}</dt><dd>
                      {spent}{t('common.minutes')}
                      {card.startedAt ? `（${hhmm(card.startedAt)}${card.finishedAt ? ' → ' + hhmm(card.finishedAt) : ' 〜'}）` : ''}
                    </dd></div>
                  ) : null}
                  {helpers.length > 0 && (
                    <div><dt>{t('card.assist')}</dt><dd>
                      <span className="detail-person">
                        {helpers.map((h) => h && <Sprite key={h.id} m={h} size={32} avatar={avatarOf(board, h)} />)}
                        {helpers.map((h) => h && localName(lang, h.name)).join(', ')}
                      </span>
                    </dd></div>
                  )}
                  {card.aiModel ? (
                    <div><dt>{t('card.aiCost')}</dt><dd>{yenFromUsd(card.aiCostUsd)}<small>{card.aiModel}</small></dd></div>
                  ) : null}
                </dl>

                <div className="modal-actions">
                  <button className="btn" onClick={() => setEditing(true)}>
                    {card.status === 'rejected' ? t('detail.fix') : t('detail.edit')}
                  </button>
                  {!isBreak(card) && (
                    <button className="btn" disabled={busy} onClick={switchKind}>
                      {isShared(card) ? t('detail.toTask') : t('detail.toCoop')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 右：メモ */}
          <aside className="detail-memo">
            <h3 className="detail-h">{t('detail.memo')} <span className="count">{card.comments?.length ?? 0}</span></h3>

            <ul className="memo-list">
              {(card.comments ?? []).map((c) => {
                const by = memberOf(c.by);
                return (
                  <li key={c.id}>
                    <div className="memo-head">
                      {by && <Sprite m={by} size={32} avatar={avatarOf(board, by)} />}
                      <b>{by ? localName(lang, by.name) : '-'}</b>
                      <time>{hhmm(c.at)}</time>
                    </div>
                    <p>{memoText(c, lang)}</p>
                  </li>
                );
              })}
              {!(card.comments ?? []).length && <li className="memo-empty">{t('detail.memoEmpty')}</li>}
            </ul>

            {me ? (
              <div className="memo-form">
                <label className="sr-only" htmlFor="memo-input">{t('detail.memoPh')}</label>
                <textarea
                  id="memo-input" className="input" value={memo} placeholder={t('detail.memoPh')}
                  onChange={(e) => setMemo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addMemo(); }
                  }}
                />
                <button className="btn primary sm" onClick={addMemo} disabled={busy || !memo.trim()}>
                  {t('detail.memoAdd')}
                </button>
              </div>
            ) : (
              <p className="memo-note">{t('detail.memoMemberOnly')}</p>
            )}
          </aside>
        </div>
      </div>
    </Dialog>
  );
}
