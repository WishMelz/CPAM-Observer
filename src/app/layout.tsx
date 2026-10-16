import type { Metadata } from "next";
import '@/styles/global.scss';
import './viewer.css';

export const metadata: Metadata = {
  title: 'CPAM Observer',
  description: 'Read-only usage analytics, request monitoring and credential insights for CPA Manager Plus.',
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body><div id="root">{children}</div></body>
    </html>
  );
}
