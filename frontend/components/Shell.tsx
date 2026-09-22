'use client';

// アプリバーの部品（貯金箱・接続アイコン・設定）。2画面で共通。
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { GearIcon, StatusIcon } from '@/components/Icons';
import { LangSwitch } from '@/components/LangSwitch';
import { Sprite } from '@/components/Sprite';
import type { Board, Member, Saving } from '@/lib/domain';
import { AVATARS, MEMBERS, avatarOf, hhmm, yen } from '@/lib/domain';
import { useLang, localName } from '@/lib/i18n';

/** 金額が増えたら数字を回す */
export function useRolling(value: number) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

export function Bank({
  total,
  label,
  savings,
  ownerFilter,
}: {
  total: number;
  label: string;
  savings: Saving[];
  ownerFilter?: (s: Saving) => boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const shown = useRolling(total);
  const list = savings.filter((s) => s.kind === 'saved' && (ownerFilter ? ownerFilter(s) : true));

  const t0 = new Date();
  t0.setHours(0, 0, 0, 0);
  const today = list.filter((s) => s.at >= t0.getTime()).reduce((a, b) => a + b.amount, 0);

  const img = total > 200000 ? 'piggy-full' : total > 50000 ? 'piggy-half' : 'piggy-01';

  return (
    <>
      <button className="bank" id="bank" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/assets/ui/${img}.png`} alt="" />
        <div>
          <span className="bank-hint">{t('bank.viewHistory')}</span>
          <div className="amount mono">{yen(shown)}</div>
          <div className="cap-label">{label}</div>
        </div>
      </button>

      {open && (
        <Dialog title={t('bank.detail')} onClose={() => setOpen(false)} compact>
          <div className="modal-h">
            <h2>{t('bank.detail')}</h2>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="chip blue">
              {t('bank.today')} {yen(today)}
            </span>
            <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          <div className="modal-b">
            <ul className="ledger">
              {list.slice(0, 12).map((s) => (
                <li key={s.id}>
                  <span>{hhmm(s.at)}</span>
                  <span style={{ flex: 1 }}>{s.label}</span>
                  <b>+{yen(s.amount)}</b>
                </li>
              ))}
              {!list.length && <li style={{ color: 'var(--dim)' }}>{t('bank.empty')}</li>}
            </ul>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function ConnDot({ online }: { online: boolean }) {
  const { t } = useLang();
  return (
    <div
      className={'conn' + (online ? '' : ' off')}
      role="status"
      aria-label={t(online ? 'common.connected' : 'common.disconnected')}
      title={t(online ? 'common.connected' : 'common.disconnected')}
    >
      <StatusIcon />
    </div>
  );
}

export function SettingsButton({ children }: { children?: React.ReactNode }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="icon-btn"
        onClick={() => setOpen(true)}
        aria-label={t('common.settings')}
        title={t('common.settings')}
      >
        <GearIcon />
      </button>

      {open && (
        <Dialog title={t('common.settings')} onClose={() => setOpen(false)} compact>
          <div className="modal-h">
            <h2>{t('common.settings')}</h2>
            <div className="spacer" style={{ flex: 1 }} />
            <button className="btn ghost sm" aria-label={t('common.close')} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modal-b">
            <div className="set-row">
              <div className="lb">
                {t('common.language')}
                <small>{t('common.languageHint')}</small>
              </div>
              <div className="rt">
                <LangSwitch />
              </div>
            </div>
            {children}
            <div className="set-row">
              <div className="lb">
                {t('nav.views')}
                <small>
                  {t('nav.leader')} / {t('nav.member')}
                </small>
              </div>
              <div className="rt">
                <Link className="btn sm" href="/leader">
                  {t('nav.leader')}
                </Link>
                <Link className="btn sm" href="/member">
                  {t('nav.member')}
                </Link>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** 設定の中で担当を選ぶ */
export function MemberPicker({ me, board, onPick }: { me?: Member; board: Board; onPick: (id: string) => void }) {
  const { t, lang } = useLang();
  return (
    <div className="set-row">
      <div className="lb">
        {t('member.switch')}
        <small>{t('member.switchHint')}</small>
      </div>
      <div className="rt">
        <div className="who-pick">
          {MEMBERS.map((m) => (
            <button key={m.id} className={me?.id === m.id ? 'on' : ''} onClick={() => onPick(m.id)}>
              <Sprite m={m} size={32} avatar={avatarOf(board, m)} />
              {localName(lang, m.name)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 自分の顔を選ぶ。選んだ顔は全員の画面に反映される。 */
export function AvatarPicker({
  me, board, onPick,
}: { me: Member; board: Board; onPick: (avatar: string) => void }) {
  const { t } = useLang();
  const cur = avatarOf(board, me);
  return (
    <div className="set-row">
      <div className="lb">
        {t('avatar.title')}
        <small>{t('avatar.hint')}</small>
      </div>
      <div className="rt">
        <div className="who-pick">
          {AVATARS.map((a) => (
            <button key={a} className={cur === a ? 'on' : ''} onClick={() => onPick(a)} title={a} aria-label={a} aria-pressed={cur === a}>
              <Sprite m={me} size={32} avatar={a} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Activity({ board }: { board: Board }) {
  const { t } = useLang();
  return (
    <ul className="feed">
      {board.feed.slice(0, 14).map((f) => (
        <li key={f.id} className={'k-' + f.kind}>
          <time>{hhmm(f.at)}</time>
          <span>{f.text}</span>
        </li>
      ))}
      {!board.feed.length && <li style={{ color: 'var(--dim)' }}>{t('leader.activityEmpty')}</li>}
    </ul>
  );
}
