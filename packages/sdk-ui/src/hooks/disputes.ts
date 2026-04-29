'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  buildCommitVoteIx,
  buildRevealVoteIx,
  buildTallyRoundIx,
  buildEscalateAppealIx,
  buildResolveDisputeIx,
  buildRegisterArbitratorIx,
  disputeConfigPda,
  disputeCasePda,
  arbitratorPda,
  disputeVotePda,
  appealPda,
} from '@saep/sdk';
import { useDisputeArbitrationProgram } from './program.js';
import { useSendTransaction } from './mutation.js';

// ── types ──────────────────────────────────────────────────────

type AnchorEnum = Record<string, object>;

export interface DisputeCaseRow {
  address: PublicKey;
  caseId: bigint;
  taskId: bigint;
  client: PublicKey;
  agentOperator: PublicKey;
  escrowAmount: bigint;
  paymentMint: PublicKey;
  status: AnchorEnum;
  round: number;
  arbitrators: PublicKey[];
  arbitratorCount: number;
  commitDeadline: number;
  revealDeadline: number;
  verdict: AnchorEnum;
  votesForAgent: bigint;
  votesForClient: bigint;
  votesForSplit: bigint;
  totalRevealedWeight: bigint;
  resolvedAt: number;
  createdAt: number;
  bump: number;
}

export interface ArbitratorRow {
  address: PublicKey;
  operator: PublicKey;
  stakeAccount: PublicKey;
  effectiveStake: bigint;
  effectiveLockEnd: number;
  status: AnchorEnum;
  badFaithStrikes: number;
  casesParticipated: number;
  withdrawUnlockTime: number;
  registeredAt: number;
}

export interface DisputeVoteRow {
  address: PublicKey;
  caseId: bigint;
  arbitrator: PublicKey;
  round: number;
  commitHash: Uint8Array;
  committedAt: number;
  revealedVerdict: AnchorEnum;
  revealed: boolean;
  revealedWeight: bigint;
  revealedAt: number;
}

export interface DisputeConfigData {
  authority: PublicKey;
  taskMarket: PublicKey;
  nxsStaking: PublicKey;
  emergencyCouncil: PublicKey;
  round1Size: number;
  round2Size: number;
  commitWindowSecs: number;
  revealWindowSecs: number;
  appealWindowSecs: number;
  appealCollateralBps: number;
  minStake: bigint;
  minLockSecs: number;
  nextCaseId: bigint;
  paused: boolean;
}

export interface AppealRow {
  address: PublicKey;
  caseId: bigint;
  appellant: PublicKey;
  round: number;
  collateralAmount: bigint;
  collateralMint: PublicKey;
  filedAt: number;
}

// ── query hooks ────────────────────────────────────────────────

export function useDisputeConfig() {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId ?? null;

  const configAddr = useMemo(() => {
    if (!programId) return null;
    return disputeConfigPda(programId)[0];
  }, [programId]);

  return useQuery({
    queryKey: ['dispute-config', configAddr?.toBase58()],
    enabled: Boolean(program && configAddr),
    staleTime: 60_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['disputeConfig'] ?? account['DisputeConfig'];
      if (!accessor) return null;
      return (await accessor.fetchNullable(configAddr!)) as DisputeConfigData | null;
    },
  });
}

export function useDisputeCase(caseId: bigint | null) {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId ?? null;

  const caseAddr = useMemo(() => {
    if (!programId || caseId === null) return null;
    return disputeCasePda(programId, caseId)[0];
  }, [programId, caseId]);

  return useQuery({
    queryKey: ['dispute-case', caseId?.toString()],
    enabled: Boolean(program && caseAddr),
    refetchInterval: 10_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['disputeCase'] ?? account['DisputeCase'];
      if (!accessor) return null;
      const raw = await accessor.fetchNullable(caseAddr!);
      if (!raw) return null;
      return mapCase(caseAddr!, raw as Record<string, unknown>);
    },
  });
}

export function useAllDisputeCases() {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId.toBase58() ?? null;

  return useQuery({
    queryKey: ['dispute-cases-all', programId],
    enabled: Boolean(program),
    staleTime: 15_000,
    queryFn: async () => {
      type CaseAccessor = { all: () => Promise<Array<{ publicKey: PublicKey; account: Record<string, unknown> }>> };
      const account = program!.account as Record<string, CaseAccessor>;
      const accessor = account['disputeCase'] ?? account['DisputeCase'];
      if (!accessor) return [];
      const raw = await accessor.all();
      return raw.map((r) => mapCase(r.publicKey, r.account));
    },
  });
}

export function useArbitratorAccount(operator: PublicKey | null) {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId ?? null;

  const arbAddr = useMemo(() => {
    if (!programId || !operator) return null;
    return arbitratorPda(programId, operator)[0];
  }, [programId, operator]);

  return useQuery({
    queryKey: ['arbitrator', operator?.toBase58()],
    enabled: Boolean(program && arbAddr),
    staleTime: 30_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['arbitratorAccount'] ?? account['ArbitratorAccount'];
      if (!accessor) return null;
      const raw = (await accessor.fetchNullable(arbAddr!)) as Record<string, unknown> | null;
      if (!raw) return null;
      return {
        address: arbAddr!,
        operator: raw.operator as PublicKey,
        stakeAccount: raw.stakeAccount as PublicKey,
        effectiveStake: raw.effectiveStake as bigint,
        effectiveLockEnd: Number(raw.effectiveLockEnd as bigint),
        status: raw.status as AnchorEnum,
        badFaithStrikes: Number(raw.badFaithStrikes),
        casesParticipated: Number(raw.casesParticipated),
        withdrawUnlockTime: Number(raw.withdrawUnlockTime as bigint),
        registeredAt: Number(raw.registeredAt as bigint),
      } satisfies ArbitratorRow;
    },
  });
}

export function useDisputeVoteRecord(caseId: bigint | null, arbitratorAddr: PublicKey | null) {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId ?? null;

  const voteAddr = useMemo(() => {
    if (!programId || caseId === null || !arbitratorAddr) return null;
    return disputeVotePda(programId, caseId, arbitratorAddr)[0];
  }, [programId, caseId, arbitratorAddr]);

  return useQuery({
    queryKey: ['dispute-vote', caseId?.toString(), arbitratorAddr?.toBase58()],
    enabled: Boolean(program && voteAddr),
    refetchInterval: 10_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['disputeVoteRecord'] ?? account['DisputeVoteRecord'];
      if (!accessor) return null;
      const raw = (await accessor.fetchNullable(voteAddr!)) as Record<string, unknown> | null;
      if (!raw) return null;
      return {
        address: voteAddr!,
        caseId: raw.caseId as bigint,
        arbitrator: raw.arbitrator as PublicKey,
        round: Number(raw.round),
        commitHash: raw.commitHash as Uint8Array,
        committedAt: Number(raw.committedAt as bigint),
        revealedVerdict: raw.revealedVerdict as AnchorEnum,
        revealed: raw.revealed as boolean,
        revealedWeight: raw.revealedWeight as bigint,
        revealedAt: Number(raw.revealedAt as bigint),
      } satisfies DisputeVoteRow;
    },
  });
}

export function useAppealRecord(caseId: bigint | null) {
  const program = useDisputeArbitrationProgram();
  const programId = program?.programId ?? null;

  const addr = useMemo(() => {
    if (!programId || caseId === null) return null;
    return appealPda(programId, caseId)[0];
  }, [programId, caseId]);

  return useQuery({
    queryKey: ['appeal', caseId?.toString()],
    enabled: Boolean(program && addr),
    staleTime: 30_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['appealRecord'] ?? account['AppealRecord'];
      if (!accessor) return null;
      const raw = (await accessor.fetchNullable(addr!)) as Record<string, unknown> | null;
      if (!raw) return null;
      return {
        address: addr!,
        caseId: raw.caseId as bigint,
        appellant: raw.appellant as PublicKey,
        round: Number(raw.round),
        collateralAmount: raw.collateralAmount as bigint,
        collateralMint: raw.collateralMint as PublicKey,
        filedAt: Number(raw.filedAt as bigint),
      } satisfies AppealRow;
    },
  });
}

// ── mutation hooks ─────────────────────────────────────────────

export interface CommitDisputeVoteInput {
  disputeCase: PublicKey;
  operator: PublicKey;
  caseId: bigint;
  commitHash: Uint8Array;
}

export function useCommitDisputeVote() {
  const program = useDisputeArbitrationProgram();
  const { publicKey } = useWallet();

  return useSendTransaction<CommitDisputeVoteInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildCommitVoteIx(program, {
        disputeCase: input.disputeCase,
        arbitratorSigner: publicKey,
        operator: input.operator,
        caseId: input.caseId,
        commitHash: input.commitHash,
      });
    },
    invalidateKeys: [['dispute-case'], ['dispute-vote'], ['dispute-cases-all']],
    commitment: 'confirmed',
  });
}

export interface RevealDisputeVoteInput {
  disputeCase: PublicKey;
  caseId: bigint;
  verdict: Record<string, never>;
  salt: Uint8Array;
}

export function useRevealDisputeVote() {
  const program = useDisputeArbitrationProgram();
  const { publicKey } = useWallet();

  return useSendTransaction<RevealDisputeVoteInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildRevealVoteIx(program, {
        disputeCase: input.disputeCase,
        arbitratorSigner: publicKey,
        caseId: input.caseId,
        verdict: input.verdict,
        salt: input.salt,
      });
    },
    invalidateKeys: [['dispute-case'], ['dispute-vote'], ['dispute-cases-all']],
    commitment: 'confirmed',
  });
}

export interface TallyRoundInput {
  disputeCase: PublicKey;
}

export function useTallyRound() {
  const { publicKey } = useWallet();
  const program = useDisputeArbitrationProgram();

  return useSendTransaction<TallyRoundInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildTallyRoundIx(program, {
        disputeCase: input.disputeCase,
        cranker: publicKey,
      });
    },
    invalidateKeys: [['dispute-case'], ['dispute-cases-all']],
    commitment: 'confirmed',
  });
}

export interface EscalateAppealInput {
  disputeCase: PublicKey;
  caseId: bigint;
}

export function useEscalateAppeal() {
  const { publicKey } = useWallet();
  const program = useDisputeArbitrationProgram();

  return useSendTransaction<EscalateAppealInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildEscalateAppealIx(program, {
        disputeCase: input.disputeCase,
        appellant: publicKey,
        caseId: input.caseId,
      });
    },
    invalidateKeys: [['dispute-case'], ['appeal'], ['dispute-cases-all']],
    commitment: 'confirmed',
  });
}

export interface ResolveDisputeInput {
  disputeCase: PublicKey;
}

export function useResolveDispute() {
  const { publicKey } = useWallet();
  const program = useDisputeArbitrationProgram();

  return useSendTransaction<ResolveDisputeInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildResolveDisputeIx(program, {
        disputeCase: input.disputeCase,
        cranker: publicKey,
      });
    },
    invalidateKeys: [['dispute-case'], ['dispute-cases-all']],
    commitment: 'confirmed',
  });
}

export interface RegisterArbitratorInput {
  stakeAccount: PublicKey;
  effectiveStake: bigint;
  lockEnd: bigint;
}

export function useRegisterArbitrator() {
  const { publicKey } = useWallet();
  const program = useDisputeArbitrationProgram();

  return useSendTransaction<RegisterArbitratorInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Dispute program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildRegisterArbitratorIx(program, {
        operator: publicKey,
        stakeAccount: input.stakeAccount,
        effectiveStake: input.effectiveStake,
        lockEnd: input.lockEnd,
      });
    },
    invalidateKeys: [['arbitrator']],
    commitment: 'confirmed',
  });
}

// ── helpers ────────────────────────────────────────────────────

function mapCase(address: PublicKey, raw: Record<string, unknown>): DisputeCaseRow {
  return {
    address,
    caseId: raw.caseId as bigint,
    taskId: raw.taskId as bigint,
    client: raw.client as PublicKey,
    agentOperator: raw.agentOperator as PublicKey,
    escrowAmount: raw.escrowAmount as bigint,
    paymentMint: raw.paymentMint as PublicKey,
    status: raw.status as AnchorEnum,
    round: Number(raw.round),
    arbitrators: raw.arbitrators as PublicKey[],
    arbitratorCount: Number(raw.arbitratorCount),
    commitDeadline: Number(raw.commitDeadline as bigint),
    revealDeadline: Number(raw.revealDeadline as bigint),
    verdict: raw.verdict as AnchorEnum,
    votesForAgent: raw.votesForAgent as bigint,
    votesForClient: raw.votesForClient as bigint,
    votesForSplit: raw.votesForSplit as bigint,
    totalRevealedWeight: raw.totalRevealedWeight as bigint,
    resolvedAt: Number(raw.resolvedAt as bigint),
    createdAt: Number(raw.createdAt as bigint),
    bump: Number(raw.bump),
  };
}
