'use client';

import { useQuery } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  getConfidentialAccountStatus,
  getConfidentialTokenAddress,
  type ConfidentialAccountStatus,
} from '@saep/sdk';

export interface ConfidentialBalance {
  tokenAccount: PublicKey;
  status: ConfidentialAccountStatus;
}

export function useConfidentialBalance(
  owner: PublicKey | null,
  mint: PublicKey | null,
) {
  const { connection } = useConnection();
  const ownerKey = owner?.toBase58() ?? null;
  const mintKey = mint?.toBase58() ?? null;

  return useQuery<ConfidentialBalance | null>({
    queryKey: ['confidential-balance', ownerKey, mintKey],
    enabled: Boolean(ownerKey && mintKey),
    staleTime: 30_000,
    queryFn: async () => {
      const tokenAccount = getConfidentialTokenAddress(
        new PublicKey(mintKey!),
        new PublicKey(ownerKey!),
      );
      const status = await getConfidentialAccountStatus(connection, tokenAccount);
      return { tokenAccount, status };
    },
  });
}
