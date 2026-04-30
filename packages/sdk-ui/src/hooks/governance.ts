import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildClaimStakerIx } from '@saep/sdk';
import { useFeeCollectorProgram } from './program.js';
import { useSendTransaction } from './mutation.js';

const FEE_CRANK_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_FEE_CRANK_URL ?? '')
    : '';

const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SAEP_MINT = new PublicKey('HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump');

export interface SnapshotData {
  epoch: string;
  governanceRoot: number[];
  totalVotingPower: string;
  stakerCount: number;
  snapshotSlot: string;
}

export interface VoterProof {
  weight: string;
  proof: number[][];
  leafIndex: number;
}

export interface ClaimProof {
  amount: string;
  proof: number[][];
  leafIndex: number;
}

export function useLatestSnapshot() {
  return useQuery<SnapshotData | null>({
    queryKey: ['snapshot', 'latest'],
    queryFn: async () => {
      if (!FEE_CRANK_URL) return null;
      const res = await fetch(`${FEE_CRANK_URL}/snapshot/latest`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      return data as SnapshotData;
    },
    staleTime: 60_000,
  });
}

export function useVoterProof(snapshotSlot: string | null, wallet: PublicKey | null) {
  return useQuery<VoterProof | null>({
    queryKey: ['snapshot', 'proof', snapshotSlot, wallet?.toBase58()],
    queryFn: async () => {
      if (!FEE_CRANK_URL || !snapshotSlot || !wallet) return null;
      const res = await fetch(`${FEE_CRANK_URL}/snapshot/by-slot/${snapshotSlot}/proof/${wallet.toBase58()}`);
      if (!res.ok) return null;
      return (await res.json()) as VoterProof;
    },
    enabled: Boolean(snapshotSlot && wallet && FEE_CRANK_URL),
    staleTime: 300_000,
  });
}

export function useStakerClaimProof(epoch: string | null, wallet: PublicKey | null) {
  return useQuery<ClaimProof | null>({
    queryKey: ['distribution', 'proof', epoch, wallet?.toBase58()],
    queryFn: async () => {
      if (!FEE_CRANK_URL || !epoch || !wallet) return null;
      const res = await fetch(`${FEE_CRANK_URL}/distribution/${epoch}/proof/${wallet.toBase58()}`);
      if (!res.ok) return null;
      return (await res.json()) as ClaimProof;
    },
    enabled: Boolean(epoch && wallet && FEE_CRANK_URL),
    staleTime: 300_000,
  });
}

export interface ClaimStakerRewardInput {
  epochId: bigint;
  amount: bigint;
  merkleProof: number[][];
}

export function useClaimStakerReward() {
  const program = useFeeCollectorProgram();
  const { publicKey } = useWallet();

  return useSendTransaction<ClaimStakerRewardInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Fee collector program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
      const stakerTokenAccount = getAssociatedTokenAddressSync(SAEP_MINT, publicKey, false, TOKEN_2022);

      return buildClaimStakerIx(program as never, {
        staker: publicKey,
        saepMint: SAEP_MINT,
        stakerTokenAccount,
        epochId: input.epochId,
        amount: input.amount,
        merkleProof: input.merkleProof.map((p) => Uint8Array.from(p)),
        tokenProgram: TOKEN_2022,
      });
    },
    invalidateKeys: [['distribution'], ['token-balance']],
  });
}
