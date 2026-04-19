'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useSession, useSiwsSignIn, useSignOut } from '@saep/sdk-ui';
import { useState } from 'react';
import { GlitchButton } from '@saep/ui';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { connected, publicKey } = useWallet();
  const { data: session, isLoading } = useSession();
  const signIn = useSiwsSignIn();
  const signOut = useSignOut();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Centered>Loading session…</Centered>;

  if (!session) {
    return (
      <Centered>
        <div className="flex flex-col gap-4 max-w-sm">
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            authentication required
          </div>
          <h1 className="font-display text-xl tracking-tight">Sign in</h1>
          <p className="text-sm text-mute">
            Connect your Solana wallet and sign a message to access the portal.
          </p>
          <WalletMultiButton />
          {connected && publicKey ? (
            <GlitchButton
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await signIn();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Sign-in failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Signing\u2026' : 'Sign message to continue'}
            </GlitchButton>
          ) : null}
          {error ? <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">ERR: {error}</div> : null}
        </div>
      </Centered>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between font-mono text-[11px] text-mute">
        <span>{session.address.slice(0, 4)}…{session.address.slice(-4)}</span>
        <button
          type="button"
          onClick={() => signOut()}
          className="text-mute hover:text-lime transition-colors"
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center min-h-[60vh]">{children}</div>;
}
