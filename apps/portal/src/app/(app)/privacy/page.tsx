'use client';

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useConfidentialBalance } from '@saep/sdk-ui';
import {
  buildConfigureConfidentialAccountIx,
  buildApplyPendingBalanceIx,
  getConfidentialTokenAddress,
} from '@saep/sdk';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const INTERNAL_SAEP_MINT = process.env.NEXT_PUBLIC_INTERNAL_SAEP_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_INTERNAL_SAEP_MINT)
  : null;

export default function PrivacyPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const qc = useQueryClient();
  const { data: ctBalance, isLoading } = useConfidentialBalance(
    publicKey ?? null,
    INTERNAL_SAEP_MINT,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const status = ctBalance?.status;

  async function configureAccount() {
    if (!publicKey || !INTERNAL_SAEP_MINT) return;
    setBusy(true);
    setError(null);
    try {
      const tokenAccount = getConfidentialTokenAddress(INTERNAL_SAEP_MINT, publicKey);
      const zeroBalance = new Uint8Array(36);
      const ix = buildConfigureConfidentialAccountIx(
        tokenAccount,
        INTERNAL_SAEP_MINT,
        publicKey,
        zeroBalance,
        65536n,
        0,
      );
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      setLastSig(sig);
      qc.invalidateQueries({ queryKey: ['confidential-balance'] });
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (!publicKey || !INTERNAL_SAEP_MINT) return;
    setBusy(true);
    setError(null);
    try {
      const tokenAccount = getConfidentialTokenAddress(INTERNAL_SAEP_MINT, publicKey);
      const newBalance = new Uint8Array(36);
      const ix = buildApplyPendingBalanceIx(tokenAccount, publicKey, 0n, newBalance);
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      setLastSig(sig);
      qc.invalidateQueries({ queryKey: ['confidential-balance'] });
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6 max-w-2xl">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          privacy
        </div>
        <h1 className="font-display text-2xl tracking-tight">Confidential Transfers</h1>
        <p className="text-sm text-mute mt-1">
          Opt in to encrypted balances and transfer amounts on the internal SAEP T22 mint.
          Requires the ZK ElGamal proof program to be active on-chain.
        </p>
      </header>

      {!INTERNAL_SAEP_MINT && (
        <div className="border border-warning/30 bg-warning/5 px-4 py-3 text-xs">
          Internal SAEP mint not configured. Set <code className="font-mono">NEXT_PUBLIC_INTERNAL_SAEP_MINT</code> in your environment.
        </div>
      )}

      {!publicKey && (
        <p className="text-xs text-mute">Connect wallet to manage privacy settings.</p>
      )}

      {publicKey && INTERNAL_SAEP_MINT && (
        <div className="border border-ink/10 p-5 flex flex-col gap-4">
          <h2 className="text-sm font-medium">Account Status</h2>

          {isLoading && <p className="text-xs text-mute">Checking account…</p>}

          {status && !status.isConfigured && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-mute">
                Not configured for confidential transfers. Configure your token account to enable encrypted balances.
              </p>
              <button
                onClick={configureAccount}
                disabled={busy}
                className="self-start font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-lime text-lime hover:bg-lime/5 transition-colors disabled:opacity-40"
              >
                {busy ? 'Configuring…' : 'Enable confidential transfers'}
              </button>
            </div>
          )}

          {status?.isConfigured && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <span className="text-mute">Configured</span>
                <span className="font-mono text-lime">Yes</span>
                <span className="text-mute">Approved</span>
                <span className={`font-mono ${status.isApproved ? 'text-lime' : 'text-warning'}`}>
                  {status.isApproved ? 'Yes' : 'Pending'}
                </span>
                <span className="text-mute">Pending balance</span>
                <span className="font-mono">
                  {status.hasPendingBalance ? 'Yes' : 'None'}
                </span>
              </div>

              {status.hasPendingBalance && (
                <button
                  onClick={applyPending}
                  disabled={busy}
                  className="self-start font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-ink/20 text-ink hover:border-ink/40 transition-colors disabled:opacity-40"
                >
                  {busy ? 'Applying…' : 'Apply pending balance'}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-danger font-mono border border-danger/20 bg-danger/5 px-3 py-2">
              {error}
            </div>
          )}

          {lastSig && (
            <p className="text-[10px] text-mute font-mono">
              tx: {lastSig.slice(0, 16)}…
            </p>
          )}
        </div>
      )}

      <div className="border border-ink/10 p-5 flex flex-col gap-3">
        <h2 className="text-sm font-medium">How it works</h2>
        <div className="text-xs text-mute leading-relaxed flex flex-col gap-2">
          <p>
            Confidential transfers use the Token-2022 ConfidentialTransfer extension to encrypt
            balances and transfer amounts using ElGamal encryption with ZK proofs.
          </p>
          <p>
            Once configured, incoming transfers to your account are encrypted. You can still
            send and receive plaintext transfers — privacy is opt-in per account.
          </p>
          <p>
            The protocol auditor key can decrypt balances for compliance. Fee collection
            works on both plaintext and encrypted transfers.
          </p>
        </div>
      </div>
    </section>
  );
}
