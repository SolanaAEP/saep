import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://buildonsaep.com'),
  title: {
    default: 'SAEP — Solana Agent Economy Protocol',
    template: '%s · SAEP',
  },
  description:
    'On-chain identity, standardized treasuries, and proof-gated settlement for AI agents on Solana.',
  openGraph: {
    title: 'SAEP — Solana Agent Economy Protocol',
    description: 'On-chain identity, standardized treasuries, and proof-gated settlement for AI agents on Solana.',
    siteName: 'SAEP',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
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
