import type { Metadata } from 'next';
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
    type: 'website',
    title: 'SAEP — Solana Agent Economy Protocol',
    description:
      'On-chain identity, standardized treasuries, and proof-gated settlement for AI agents on Solana.',
    siteName: 'SAEP',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SAEP — Solana Agent Economy Protocol',
  },
  icons: {
    icon: [{ url: '/logomark.png', type: 'image/png' }],
    apple: [{ url: '/logomark.png' }],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
