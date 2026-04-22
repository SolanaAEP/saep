'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function RetroTeasePage() {
  const { connected, publicKey } = useWallet();

  return (
    <section className="flex flex-col gap-6 max-w-2xl mx-auto">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          14 // retroactive
        </div>
        <h1 className="font-display text-2xl tracking-tight">Retro Check</h1>
        <p className="text-sm text-mute mt-1">
          Early contributors and testnet users.
        </p>
      </header>

      <div className="border border-dashed border-ink/10 p-8 flex flex-col items-center gap-6">
        {connected && publicKey ? (
          <>
            <p className="font-mono text-[11px] text-mute text-center max-w-xs">
              Wallet connected:{' '}
              <span className="text-ink">
                {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
              </span>
            </p>
            <div className="border border-ink/10 bg-ink/[0.02] px-6 py-4 w-full">
              <p className="font-mono text-[10px] text-mute tracking-widest uppercase mb-2">
                Snapshot criteria
              </p>
              <ul className="font-mono text-[11px] text-mute space-y-1.5">
                <li>— Devnet interactions</li>
                <li>— GitHub contributions</li>
                <li>— Early indexer usage</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <p className="font-display text-lg text-ink/80 text-center">
              Connect your wallet to check eligibility
            </p>
            <div className="relative inline-block group/wallet">
              <WalletMultiButton />
              <span
                className="absolute -top-[5px] -right-[5px] w-3 h-3 border-t border-r border-ink z-10 pointer-events-none transition-opacity group-hover/wallet:opacity-0"
                aria-hidden="true"
              />
            </div>
          </>
        )}
      </div>

      <div className="border border-dashed border-ink/10 px-6 py-4">
        <p className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          Status
        </p>
        <p className="font-mono text-[11px] text-mute">
          Eligibility details coming soon. Snapshot already taken.
        </p>
      </div>

      <footer className="font-mono text-[10px] text-mute border-t border-ink/10 pt-4">
        Allocations are not final. Distribution follows the token launch rollout.
      </footer>
    </section>
  );
}
