import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Be_Vietnam_Pro } from 'next/font/google';

import { getTheme } from '@/lib/theme';

import './globals.css';

/**
 * Be Vietnam Pro is the product face: it is drawn for Vietnamese, so diacritics sit
 * correctly at every weight. Only the weights the interface uses are downloaded (400
 * body, 500 `font-medium`, 600 `font-semibold`) — a heavier weight has to be added here
 * first, or the browser synthesises it.
 */
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--font-be-vietnam-pro',
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
      <body className={`${beVietnamPro.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
