import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import { getTheme } from '@/lib/theme';

import './globals.css';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'OPVARYN — Business Operations Platform',
    template: '%s · OPVARYN',
  },
  description:
    'Nền tảng xây dựng và điều phối hoạt động nội bộ: tổ chức tự định nghĩa dữ liệu, quy trình, ứng dụng nghiệp vụ và báo cáo.',
};

/**
 * The root layout carries only what every page needs: the theme cookie, the font and
 * the document. The workspace frame (sidebar, topbar, footer) lives in
 * `(workspace)/layout.tsx`, because the public landing page and the sign-in screen
 * must not wear the application chrome (ADR 0014).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme cookie is read on the server so the first paint already has the
  // right tokens; there is no flash and no client-side theme script.
  const theme = await getTheme();

  return (
    <html lang="vi" data-theme={theme}>
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
