'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatSiwsMessage, type SiwsMessage } from '@saep/sdk';

export interface Session {
  address: string;
  expiresAt: string;
}

async function fetchSession(): Promise<Session | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  const body = (await res.json()) as { session: Session | null };
  return body.session;
}

export function useSession() {
  return useQuery({
    queryKey: ['auth', 'session'],
    queryFn: fetchSession,
    staleTime: 30_000,
  });
}

export function useSiwsSignIn() {
  const { publicKey, signMessage } = useWallet();
  const qc = useQueryClient();

  return useCallback(async () => {
    if (!publicKey) throw new Error('Connect a wallet first');
    if (!signMessage) throw new Error('Wallet does not support signMessage');

    const nonceRes = await fetch('/api/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: publicKey.toBase58() }),
    });
    if (!nonceRes.ok) throw new Error('Failed to fetch nonce');
    const { message } = (await nonceRes.json()) as { message: SiwsMessage };
    const formatted = formatSiwsMessage(message);
    const signature = await signMessage(new TextEncoder().encode(formatted));

    const verifyRes = await fetch('/api/auth/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        signature: Buffer.from(signature).toString('base64'),
      }),
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? 'Verification failed');
    }
    await qc.invalidateQueries({ queryKey: ['auth', 'session'] });
  }, [publicKey, signMessage, qc]);
}

export function useSignOut() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    await qc.invalidateQueries({ queryKey: ['auth', 'session'] });
  }, [qc]);
}
