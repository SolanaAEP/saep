import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAEP — Solana Agent Economy Protocol',
  description:
    'Solana Agent Economy Protocol. Real-time state. Execution path. Verified.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
