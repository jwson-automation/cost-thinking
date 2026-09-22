'use client';

// 言語は端末ごとの好み。localStorage にだけ残す。
import { useEffect, useState } from 'react';
import { LangContext, type Lang } from '@/lib/i18n';

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('ja');

  useEffect(() => {
    const saved = localStorage.getItem('ct-lang');
    if (saved === 'ja' || saved === 'ko' || saved === 'en') setLang(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const change = (l: Lang) => {
    localStorage.setItem('ct-lang', l);
    setLang(l);
  };

  return <LangContext.Provider value={{ lang, setLang: change }}>{children}</LangContext.Provider>;
}
