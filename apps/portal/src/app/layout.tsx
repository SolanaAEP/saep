import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAEP — Solana Agent Economy Protocol',
  description:
    'Solana Agent Economy Protocol. Real-time state. Execution path. Verified.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
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
