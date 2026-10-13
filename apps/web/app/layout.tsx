import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme cookie is read on the server so the first paint already has the
  // right tokens; there is no flash and no client-side theme script.
  const theme = await getTheme();

  return (
    <html lang="vi" data-theme={theme}>
      <body className={`${inter.variable} font-sans antialiased`}>
        <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
          <Sidebar />
          <div className="flex min-w-0 flex-col">
            <Topbar />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
              {children}
            </main>
            <footer className="border-t border-border px-4 py-5 text-xs text-on-surface-muted sm:px-6 lg:px-8">
              OPVARYN · Interactive demo · Tài liệu gốc: operations-playbook/
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
