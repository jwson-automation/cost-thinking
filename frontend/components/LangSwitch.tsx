'use client';

import { useLang, type Lang } from '@/lib/i18n';

const OPTIONS: { id: Lang; label: string }[] = [
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-sw">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          aria-pressed={lang === o.id}
          className={lang === o.id ? 'on' : ''}
          onClick={() => setLang(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
