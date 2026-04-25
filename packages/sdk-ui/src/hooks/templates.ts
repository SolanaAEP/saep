'use client';

import { useQuery } from '@tanstack/react-query';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  buildClaimRentalRevenueIx,
  buildCloseRentalIx,
  buildForkTemplateIx,
  buildOpenRentalIx,
  fetchAllTemplates,
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
  fetchTemplateRentalsByRenter,
  type ClaimRentalRevenueInput,
  type CloseRentalInput,
  type ForkTemplateInput,
  type OpenRentalInput,
} from '@saep/sdk';
import { useSendTransaction } from './mutation.js';
import { useTemplateRegistryProgram } from './program.js';

export interface RentTemplateInput {
  templateId: Uint8Array;
  mint: PublicKey;
  durationSecs: bigint;
  rentalNonce: Uint8Array;
  renterTokenAccount?: PublicKey;
}

export interface ForkTemplateMutationInput {
  parentTemplateId: Uint8Array;
  childAgentDid: Uint8Array;
}

export interface ClaimTemplateRentalInput {
  rental: PublicKey;
  templateId: Uint8Array;
  mint: PublicKey;
  author: PublicKey;
  feeCollectorTokenAccount: PublicKey;
}

export interface CloseTemplateRentalInput extends ClaimTemplateRentalInput {
  renter: PublicKey;
}

async function resolveTokenProgram(
  connection: ReturnType<typeof useConnection>['connection'],
  mint: PublicKey,
): Promise<PublicKey> {
  const mintAccount = await connection.getAccountInfo(mint, 'confirmed');
  if (!mintAccount) {
    throw new Error(`Mint ${mint.toBase58()} was not found on the current cluster`);
  }
  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error('Template escrow mint is not owned by SPL Token or Token-2022');
}

function requireBytes(value: Uint8Array, len: number, label: string): Uint8Array {
  if (value.length !== len) throw new Error(`${label} must be ${len} bytes`);
  return value;
}

export function useTemplateRegistryConfig() {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-registry', 'config'],
    enabled: Boolean(program),
    queryFn: () => fetchTemplateRegistryConfig(program!),
    staleTime: 30_000,
  });
}

export function useAllTemplates() {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['templates', 'all'],
    enabled: Boolean(program),
    queryFn: () => fetchAllTemplates(program!),
    staleTime: 30_000,
  });
}

export function useTemplate(templateIdHex: string | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template', templateIdHex],
    enabled: Boolean(program && templateIdHex && templateIdHex.length === 64),
    queryFn: () => fetchTemplateById(program!, templateIdHex!),
    staleTime: 30_000,
  });
}

export function useTemplateForks(parentTemplate: PublicKey | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-forks', parentTemplate?.toBase58()],
    enabled: Boolean(program && parentTemplate),
    queryFn: () => fetchTemplateForks(program!, parentTemplate!),
    staleTime: 30_000,
  });
}

export function useTemplateRentals(template: PublicKey | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-rentals', template?.toBase58()],
    enabled: Boolean(program && template),
    queryFn: () => fetchTemplateRentals(program!, template!),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTemplateRentalsByRenter(renter: PublicKey | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-rentals-by-renter', renter?.toBase58()],
    enabled: Boolean(program && renter),
    queryFn: () => fetchTemplateRentalsByRenter(program!, renter!),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useRentTemplate() {
  const program = useTemplateRegistryProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useSendTransaction<RentTemplateInput>({
    buildInstruction: async (input) => {
      if (!program || !publicKey) throw new Error('Wallet not connected');
      const templateId = requireBytes(input.templateId, 32, 'templateId');
      const rentalNonce = requireBytes(input.rentalNonce, 8, 'rentalNonce');
      const tokenProgram = await resolveTokenProgram(connection, input.mint);
      const renterTokenAccount =
        input.renterTokenAccount ??
        getAssociatedTokenAddressSync(input.mint, publicKey, false, tokenProgram);
      const builderInput: OpenRentalInput = {
        renter: publicKey,
        templateId,
        mint: input.mint,
        renterTokenAccount,
        durationSecs: input.durationSecs,
        rentalNonce,
        tokenProgram,
      };
      return buildOpenRentalIx(program, builderInput);
    },
    invalidateKeys: [['templates'], ['template'], ['template-rentals'], ['template-rentals-by-renter']],
    priorityFee: 'auto',
  });
}

export function useForkTemplate() {
  const program = useTemplateRegistryProgram();
  const { publicKey } = useWallet();

  return useSendTransaction<ForkTemplateMutationInput>({
    buildInstruction: async (input) => {
      if (!program || !publicKey) throw new Error('Wallet not connected');
      const builderInput: ForkTemplateInput = {
        forker: publicKey,
        parentTemplateId: requireBytes(input.parentTemplateId, 32, 'parentTemplateId'),
        childAgentDid: requireBytes(input.childAgentDid, 32, 'childAgentDid'),
      };
      return buildForkTemplateIx(program, builderInput);
    },
    invalidateKeys: [['templates'], ['template'], ['template-forks']],
    priorityFee: 'auto',
  });
}

export function useClaimRentalRevenue() {
  const program = useTemplateRegistryProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useSendTransaction<ClaimTemplateRentalInput>({
    buildInstruction: async (input) => {
      if (!program || !publicKey) throw new Error('Wallet not connected');
      const tokenProgram = await resolveTokenProgram(connection, input.mint);
      const authorTokenAccount = getAssociatedTokenAddressSync(
        input.mint,
        input.author,
        true,
        tokenProgram,
      );
      const builderInput: ClaimRentalRevenueInput = {
        cranker: publicKey,
        rental: input.rental,
        templateId: requireBytes(input.templateId, 32, 'templateId'),
        mint: input.mint,
        authorTokenAccount,
        feeCollectorTokenAccount: input.feeCollectorTokenAccount,
        tokenProgram,
      };
      return buildClaimRentalRevenueIx(program, builderInput);
    },
    invalidateKeys: [['templates'], ['template'], ['template-rentals'], ['template-rentals-by-renter']],
    priorityFee: 'auto',
  });
}

export function useCloseTemplateRental() {
  const program = useTemplateRegistryProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useSendTransaction<CloseTemplateRentalInput>({
    buildInstruction: async (input) => {
      if (!program || !publicKey) throw new Error('Wallet not connected');
      const tokenProgram = await resolveTokenProgram(connection, input.mint);
      const authorTokenAccount = getAssociatedTokenAddressSync(
        input.mint,
        input.author,
        true,
        tokenProgram,
      );
      const renterTokenAccount = getAssociatedTokenAddressSync(
        input.mint,
        input.renter,
        false,
        tokenProgram,
      );
      const builderInput: CloseRentalInput = {
        signer: publicKey,
        rental: input.rental,
        templateId: requireBytes(input.templateId, 32, 'templateId'),
        mint: input.mint,
        authorTokenAccount,
        feeCollectorTokenAccount: input.feeCollectorTokenAccount,
        renterTokenAccount,
        tokenProgram,
      };
      return buildCloseRentalIx(program, builderInput);
    },
    invalidateKeys: [['templates'], ['template'], ['template-rentals'], ['template-rentals-by-renter']],
    priorityFee: 'auto',
  });
}
