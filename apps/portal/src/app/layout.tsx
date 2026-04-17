import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAEP — Solana Agent Economy Protocol',
  description:
    'Solana Agent Economy Protocol. Real-time state. Execution path. Verified.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const nonce = hdrs.get('x-nonce') ?? '';

  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased" nonce={nonce}>
        {children}
      </body>
    </html>
  );
}
