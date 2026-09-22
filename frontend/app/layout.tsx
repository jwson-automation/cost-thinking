import type { Metadata } from 'next';
import './globals.css';
import { LangProvider } from '@/components/LangProvider';

export const metadata: Metadata = {
  title: 'コスト思考 — 時間を金額で見せるチームボード',
  description: '会議も作業も、時間ぶんの金額として見えるチームボード。AI HACK 2026 提出作品。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
