'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { OrcaMessage } from '@/components/OrcaMessage';
import { api, generateCandidates, type CandidateResult } from '@/lib/api';
import type { BreakKind, Card, CardKind } from '@/lib/domain';
import {
  BREAK_KINDS,
  BREAK_LABEL,
  BREAK_MINUTES,
  CARD_KINDS,
  MEMBERS,
  PRIORITY,
  costOf,
  estimateMinutes,
  yen,
  yenFromUsd,
} from '@/lib/domain';
import { localName, useLang } from '@/lib/i18n';

type Priority = 'high' | 'mid' | 'low';

export function CreateCardModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t, lang } = useLang();
  const [step, setStep] = useState<1 | 2>(1);
  const [goal, setGoal] = useState('');
  const [materials, setMaterials] = useState('');
  const [checkInput, setCheckInput] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>('mid');
  const [complexity, setComplexity] = useState<Priority>('mid');
  const [kind, setKind] = useState<CardKind>('task');
  const [breakKind, setBreakKind] = useState<BreakKind>('meal');
  const [members, setMembers] = useState<string[]>([]);
  // 既定は次の30分区切り。会議は「いつやるか」を先に決めるものなので空にしない。
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60000);
    d.setMinutes(d.getMinutes() > 30 ? 0 : 30, 0, 0);
    if (d.getMinutes() === 0) d.setHours(d.getHours() + 1);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const shared = kind === 'meeting' || kind === 'coop';
  // 入力は時刻だけ。日付は今日として扱う。
  const startAtMs = () => {
    const [h, m] = startTime.split(':').map(Number);
    if (Number.isNaN(h)) return 0;
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  };
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<CandidateResult | null>(null);
  const generation = useRef<AbortController | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);
  const pending = busy || saving !== null;
  const generating = busy && kind !== 'break';
  useEffect(
    () => () => {
      generation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const restore = wasPending.current && !pending;
    wasPending.current = pending;
    if (!restore) return;
    const frame = requestAnimationFrame(() => {
      const target =
        content.current?.querySelector<HTMLElement>('#card-goal') ??
        content.current?.querySelector<HTMLElement>('.choice button, button');
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pending]);
  const cancelGeneration = () => {
    generation.current?.abort();
    generation.current = null;
    setBusy(false);
  };
  // 担当は後で決めるので、見積もりの目安はチーム標準の単価で出す
  const preview = (estMin: number) =>
    ({
      estMin,
      kind,
      participants: members,
      assignee: '',
      assist: {},
    }) as unknown as Card;
  const addCheck = () => {
    if (!checkInput.trim()) return;
    setChecklist([...checklist, checkInput.trim()]);
    setCheckInput('');
  };
  // 食事・休憩はAIに考えさせることがない。その場で1枚作る。
  const createBreak = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.createCard({
        title: BREAK_LABEL[breakKind],
        summary: '',
        checklist: [],
        priority: 'low',
        kind: 'break',
        breakKind,
        estMin: BREAK_MINUTES[breakKind],
        participants: members,
        origin: 'break',
        lang,
      });
    } catch {
      setError(t('common.saveFailed'));
      setBusy(false);
      savingRef.current = false;
      return;
    }
    onClose();
    void Promise.resolve(onCreated()).catch(() => {});
  };

  const run = async () => {
    if (generation.current || savingRef.current) return;
    if (kind === 'break') return createBreak();
    if (!goal.trim()) {
      setError(t('modal.needGoal'));
      return;
    }
    if (shared && members.length === 0) {
      setError(t('modal.membersNeed'));
      return;
    }
    const controller = new AbortController();
    generation.current = controller;
    setBusy(true);
    setError('');
    try {
      const out = await generateCandidates(
        {
          goal: goal.trim(),
          checklist,
          priority,
          complexity,
          materials,
          lang,
          kind,
          participants: members,
          hintMin: estimateMinutes({
            goal: goal.trim(),
            checklist,
            complexity,
            kind,
            participants: members,
          }),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAi(out);
      setStep(2);
    } catch {
      if (!controller.signal.aborted) setError(t('modal.aiFailed'));
    } finally {
      if (generation.current === controller) {
        generation.current = null;
        setBusy(false);
      }
    }
  };
  const choose = async (i: number) => {
    if (!ai || savingRef.current) return;
    savingRef.current = true;
    setSaving(i);
    setError('');
    const c = ai.candidates[i];
    try {
      await api.createCard({
        title: c.title,
        summary: c.summary,
        checklist: c.checklist,
        priority,
        complexity,
        kind,
        participants: members,
        startAt: shared ? startAtMs() : 0,
        estMin: c.estMin,
        origin: c.kind,
        lang,
        materials,
        aiModel: ai.fallback ? '' : ai.model,
        aiCostUsd: ai.costUsd,
      });
    } catch {
      setError(t('common.saveFailed'));
      setSaving(null);
      savingRef.current = false;
      return;
    }
    // Creation succeeded: do not offer a second save if the subsequent refresh fails.
    onClose();
    void Promise.resolve(onCreated()).catch(() => {});
  };

  return (
    <Dialog
      title={t(pending ? (generating ? 'orca.generating' : 'orca.saving') : 'modal.title')}
      onClose={onClose}
      dismissible={!pending}
      compact={pending}
      className={pending ? 'orca-dialog' : ''}
    >
      {pending && (
        <OrcaMessage
          title={t(generating ? 'orca.generating' : 'orca.saving')}
          description={t(generating ? 'orca.generatingHint' : 'orca.savingHint')}
          loading
        >
          {generating && <button className="btn ghost orca-cancel" onClick={cancelGeneration}>{t('common.cancel')}</button>}
        </OrcaMessage>
      )}
      <div ref={content} hidden={pending}>
      <div className="modal-h">
        <h2>{t('modal.title')}</h2>
        <span className="chip">{t(step === 1 ? 'modal.step1' : 'modal.step2')}</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </div>
      <div className="modal-b">
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {step === 1 ? (
          <>
            <div className="field">
              <span className="field-label" id="kind-label">{t('kind.label')}</span>
              <div className="kind-pick" role="group" aria-labelledby="kind-label">
                {CARD_KINDS.map((k) => (
                  <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                    <b>{t('kind.' + k)}</b>
                    <small>{t('kind.' + k + 'Hint')}</small>
                  </button>
                ))}
              </div>
            </div>

            {kind === 'break' && (
              <div className="field">
                <span className="field-label" id="break-label">{t('kind.break')}</span>
                <div className="seg" role="group" aria-labelledby="break-label">
                  {BREAK_KINDS.map((b) => (
                    <button key={b} className={breakKind === b ? 'on' : ''} aria-pressed={breakKind === b} onClick={() => setBreakKind(b)}>
                      {t('break.' + b)}
                    </button>
                  ))}
                </div>
                <small className="note">
                  {BREAK_MINUTES[breakKind]}{t('common.minutes')} · {t('break.free')}
                </small>
              </div>
            )}

            {shared && (
              <div className="field">
                <label htmlFor="card-start">{t('modal.startAt')}</label>
                <input
                  id="card-start" className="input time" type="time" step={300}
                  value={startTime} onChange={(e) => setStartTime(e.target.value)}
                />
                <small className="note">{t('modal.startAtHint')}</small>
              </div>
            )}

            {(shared || kind === 'break') && (
              <div className="field">
                <span className="field-label" id="members-label">{t('modal.members')}</span>
                <div className="participant-options" role="group" aria-labelledby="members-label">
                  {MEMBERS.map((m) => (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        checked={members.includes(m.id)}
                        onChange={(e) =>
                          setMembers(e.target.checked ? [...members, m.id] : members.filter((id) => id !== m.id))
                        }
                      />
                      {localName(lang, m.name)}
                      <small>{localName(lang, m.title)}</small>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {kind !== 'break' && (
            <>
            <div className="field">
              <label htmlFor="card-goal">{t('modal.goal')}</label>
              <textarea
                id="card-goal"
                className="input"
                value={goal}
                placeholder={t('modal.goalPh')}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="card-check">{t('modal.checklist')}</label>
              <div className="chk-row">
                <input
                  id="card-check"
                  className="input"
                  value={checkInput}
                  placeholder={t('modal.checkPh')}
                  onChange={(e) => setCheckInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addCheck();
                    }
                  }}
                />
                <button className="btn" onClick={addCheck}>
                  {t('modal.add')}
                </button>
              </div>
              <div className="chk-list">
                {checklist.map((c, i) => (
                  <div className="chk-item" key={i}>
                    <span>{c}</span>
                    <button
                      aria-label={t('common.remove') + ': ' + c}
                      onClick={() => setChecklist(checklist.filter((_, k) => k !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <span className="field-label" id="priority-label">
                  {t('modal.priority')}
                </span>
                <div className="seg" role="group" aria-labelledby="priority-label">
                  {(['high', 'mid', 'low'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      className={priority === p ? 'on' : ''}
                      aria-pressed={priority === p}
                      onClick={() => setPriority(p)}
                    >
                      {t(PRIORITY[p].key)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="complexity-label">
                  {t('modal.complexity')}
                </span>
                <div className="seg" role="group" aria-labelledby="complexity-label">
                  {(['low', 'mid', 'high'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      className={complexity === p ? 'on' : ''}
                      aria-pressed={complexity === p}
                      onClick={() => setComplexity(p)}
                    >
                      {t('complexity.' + p)}
                    </button>
                  ))}
                </div>
                <small className="note">{t('modal.complexityHint')}</small>
              </div>
            </div>
            <div className="field">
              <label htmlFor="card-materials">{t('modal.materials')}</label>
              <textarea
                id="card-materials"
                className="input"
                value={materials}
                placeholder={t('modal.materialsPh')}
                onChange={(e) => setMaterials(e.target.value)}
              />
            </div>
            </>
            )}
            <div className="modal-actions">
              <span className="note">{kind === 'break' ? '' : t('modal.aiNote')}</span>
              <button className="btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={run} disabled={busy}>
                {busy ? t('modal.generating') : kind === 'break' ? t('modal.createBreak') : t('modal.generate')}
              </button>
            </div>
          </>
        ) : (
          <>
            {ai &&
              (ai.fallback ? (
                <div className="ai-meta warn">{t('modal.aiFallback')}</div>
              ) : (
                <div className="ai-meta">
                  <span>{t('modal.aiCost')}</span>
                  <b>{yenFromUsd(ai.costUsd)}</b>
                </div>
              ))}
            <div className="modal-actions">
              <p className="note">{t('modal.pickHint')}</p>
              <button
                className="btn sm"
                disabled={saving !== null}
                onClick={() => {
                  setError('');
                  setStep(1);
                }}
              >
                {t('modal.back')}
              </button>
            </div>
            <div className="choices">
              {ai?.candidates.map((c, i) => (
                <article className="choice" key={i}>
                  <div className="tag">{c.tag}</div>
                  <h3>{c.title}</h3>
                  <p className="sub">{c.summary}</p>
                  <ul className="check">
                    {c.checklist.map((x, k) => (
                      <li key={k}>{x}</li>
                    ))}
                  </ul>
                  <p className="note">{c.note}</p>
                  <div className="est">
                    <span className="chip">
                      {c.estMin}
                      {t('common.minutes')}
                    </span>
                    <b>{yen(costOf(preview(c.estMin)))}</b>
                  </div>
                  <button className="btn primary" disabled={saving !== null} onClick={() => choose(i)}>
                    {saving === i ? t('modal.saving') : t('modal.choose')}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
      </div>
    </Dialog>
  );
}
