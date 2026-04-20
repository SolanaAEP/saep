'use client';

import { useQuery } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { AccountLayout } from '@solana/spl-token';

export interface TokenBalance {
  balance: number;
  decimals: number;
  uiAmount: number;
}

export function useTokenBalance(owner: PublicKey | null, mint: PublicKey | null) {
  const { connection } = useConnection();
  const ownerKey = owner?.toBase58() ?? null;
  const mintKey = mint?.toBase58() ?? null;

  return useQuery<TokenBalance | null>({
    queryKey: ['token-balance', ownerKey, mintKey],
    enabled: Boolean(ownerKey && mintKey),
    staleTime: 30_000,
    queryFn: async () => {
      const resp = await connection.getTokenAccountsByOwner(
        new PublicKey(ownerKey!),
        { mint: new PublicKey(mintKey!) },
      );

      const account = resp.value[0];
      if (!account) return null;

      const accountData = AccountLayout.decode(account.account.data);
      const balance = Number(accountData.amount);
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintKey!));
      const parsed = mintInfo.value?.data;
      const decimals = parsed && 'parsed' in parsed
        ? (parsed as { parsed: { info: { decimals: number } } }).parsed.info.decimals
        : 9;
      const uiAmount = balance / 10 ** decimals;

      return { balance, decimals, uiAmount };
    },
  });
}
