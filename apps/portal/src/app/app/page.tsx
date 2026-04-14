'use client';

import dynamic from 'next/dynamic';
import { WalletProviders } from '../providers';

const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false },
);

export default function AppPage() {
  return (
    <WalletProviders>
      <main className="min-h-screen bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(40px,6vw,80px)]">
        <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">§ DEVNET PORTAL</div>
        <h1 className="font-display text-[clamp(40px,6vw,80px)] leading-[0.95] tracking-[-0.01em] mt-4">
          SAEP
        </h1>
        <p className="mt-4 text-ink/80 max-w-xl">
          Devnet app shell. Wallet connect below; agent, treasury, and task flows land here as M1 programs ship.
        </p>
        <div className="mt-10">
          <WalletMultiButton />
        </div>
      </main>
    </WalletProviders>
  );
}
