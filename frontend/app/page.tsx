'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LangSwitch } from '@/components/LangSwitch';
import { api } from '@/lib/api';
import { useLang } from '@/lib/i18n';

export default function EntryPage() {
  const { t } = useLang();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async (demo: boolean) => {
    if (!confirm(t(demo ? 'entry.confirmDemo' : 'entry.confirmEmpty'))) return;
    setBusy(true);
    setError('');
    try {
      await api.reset();
      if (demo) await api.seed();
      router.push('/leader');
    } catch {
      setError(t('common.loadFailed'));
      setBusy(false);
    }
  };
  return (
    <main className="entry">
      <header className="entry-top">
        <div className="brand">
          <span className="brand-mark">Cost.</span>
          <b>{t('app.name')}</b>
        </div>
        <div className="spacer" />
        <LangSwitch />
      </header>
      <div className="entry-intro">
        <h1>{t('entry.heading')}</h1>
        <p>{t('entry.intro')}</p>
      </div>
      {error && (
        <p className="error-message entry-error" role="alert">
          {error}
        </p>
      )}
      <div className="halves">
        <button className="half demo" onClick={() => open(true)} disabled={busy}>
          <span className="tag">{t('entry.demoTag')}</span>
          <h2>{t('entry.demoTitle')}</h2>
          <p>{t('entry.demoBody')}</p>
          <span className="go">
            {t('entry.demoGo')} <i aria-hidden="true">→</i>
          </span>
        </button>
        {/* 空のボードはまだ出さない。デモだけを入口にする。 */}
        <button className="half real" disabled aria-disabled="true">
          <span className="tag">{t('entry.realSoon')}</span>
          <h2>{t('entry.realTitle')}</h2>
          <p>{t('entry.realBody')}</p>
          <span className="go">{t('entry.realSoon')}</span>
        </button>
      </div>
      <footer className="entry-foot">{t('entry.foot')}</footer>
    </main>
  );
}
