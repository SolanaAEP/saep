import type { Metadata } from 'next';
import { WalletProviders } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAEP',
  description: 'Solana Agent Economy Protocol',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
