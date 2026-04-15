'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useSession, useSiwsSignIn, useSignOut } from '@saep/sdk-ui';
import { useState } from 'react';

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
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-ink/70">
            Connect your Solana wallet and sign a message to access the portal.
          </p>
          <WalletMultiButton />
          {connected && publicKey ? (
            <button
              type="button"
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
              className="h-10 rounded bg-ink text-paper text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Signing…' : 'Sign message to continue'}
            </button>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Centered>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm text-ink/70">
        <span className="font-mono">{session.address.slice(0, 4)}…{session.address.slice(-4)}</span>
        <button
          type="button"
          onClick={() => signOut()}
          className="underline hover:text-ink"
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
