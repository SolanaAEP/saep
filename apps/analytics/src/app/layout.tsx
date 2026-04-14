import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAEP Analytics',
  description: 'Public analytics for the Solana Agent Economy Protocol.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
