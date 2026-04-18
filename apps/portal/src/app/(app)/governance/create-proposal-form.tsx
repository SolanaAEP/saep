'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useGovernanceProgram, useSendTransaction } from '@saep/sdk-ui';
import type { GovernanceConfigData, ProposalCategory } from './types';
import { PROPOSAL_CATEGORIES, CATEGORY_LABELS } from './types';

interface Props {
  config: GovernanceConfigData | null;
  walletConnected: boolean;
}

const PARAMETER_HINTS: Record<ProposalCategory, string> = {
  ParameterChange: 'Target program parameter (e.g. fee_bps, min_stake)',
  ProgramUpgrade: 'Program ID to upgrade',
  TreasurySpend: 'Recipient address and amount',
  EmergencyPause: 'Program to pause',
  CapabilityTagUpdate: 'Capability tag name and bitmap position',
  Meta: 'Governance parameter to change',
};

export function CreateProposalForm({ config, walletConnected }: Props) {
  const { publicKey } = useWallet();
  const program = useGovernanceProgram();

  const [category, setCategory] = useState<ProposalCategory>('ParameterChange');
  const [targetProgram, setTargetProgram] = useState('');
  const [metadataUri, setMetadataUri] = useState('');
  const [ixDataHex, setIxDataHex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const minStake = config ? Number(config.minProposerStake) / 1e9 : null;
  const collateral = config ? Number(config.proposerCollateral) / 1e9 : null;

  const targetPubkey = useMemo(() => {
    try {
      return targetProgram ? new PublicKey(targetProgram) : null;
    } catch {
      return null;
    }
  }, [targetProgram]);

  const ixData = useMemo(() => {
    try {
      if (!ixDataHex) return new Uint8Array(0);
      const clean = ixDataHex.replace(/\s/g, '');
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    } catch {
      return null;
    }
  }, [ixDataHex]);

  const valid = Boolean(
    targetPubkey && metadataUri.length > 0 && ixData && publicKey && program,
  );

  const configPda = useMemo(() => {
    if (!program) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('governance_config')],
      program.programId,
    );
    return pda;
  }, [program]);

  const registryPda = useMemo(() => {
    if (!program) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('program_registry')],
      program.programId,
    );
    return pda;
  }, [program]);

  const categoryArg = useMemo(() => {
    const map: Record<ProposalCategory, Record<string, object>> = {
      ParameterChange: { parameterChange: {} },
      ProgramUpgrade: { programUpgrade: {} },
      TreasurySpend: { treasurySpend: {} },
      EmergencyPause: { emergencyPause: {} },
      CapabilityTagUpdate: { capabilityTagUpdate: {} },
      Meta: { meta: {} },
    };
    return map[category];
  }, [category]);

  const { mutateAsync: submitProposal, isPending } = useSendTransaction<void>({
    buildInstruction: async () => {
      if (!program || !publicKey || !targetPubkey || !ixData || !configPda || !registryPda) {
        throw new Error('Missing required fields');
      }

      const nextId = config?.nextProposalId ?? 0n;
      const [proposalPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('proposal'), Buffer.from(new BigUint64Array([BigInt(nextId)]).buffer)],
        program.programId,
      );

      const metadataBytes = Buffer.from(metadataUri, 'utf-8');

      // placeholder snapshot -- real impl reads from staking snapshot oracle
      const snapshot = {
        totalEligibleWeight: 0n as unknown as number,
        snapshotSlot: 0n as unknown as number,
        snapshotRoot: new Array(32).fill(0),
      };

      return await program.methods
        .propose(
          categoryArg,
          targetPubkey,
          Buffer.from(ixData),
          metadataBytes,
          snapshot,
        )
        .accounts({
          proposer: publicKey,
        } as any)
        .instruction();
    },
    invalidateKeys: [['governance-proposals'], ['governance-config']],
  });

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await submitProposal();
      setSuccess(`Proposal submitted. Tx: ${result.signature.slice(0, 16)}...`);
      setTargetProgram('');
      setMetadataUri('');
      setIxDataHex('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [valid, submitProposal]);

  if (!walletConnected) {
    return (
      <div className="border border-ink/10 p-8 text-center">
        <p className="text-sm text-ink/50">Connect wallet to create a proposal.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink/10 p-6 flex flex-col gap-5 max-w-xl bg-ink/[0.02]">
      <h2 className="text-sm font-semibold">Create proposal</h2>

      <div className="flex gap-4 text-xs text-ink/50">
        {minStake !== null && (
          <span>Min stake: <span className="text-ink font-mono">{minStake}</span> SOL</span>
        )}
        {collateral !== null && (
          <span>Collateral: <span className="text-ink font-mono">{collateral}</span> SOL</span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink/70">Proposal type</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ProposalCategory)}
          className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm focus:border-lime/60 focus:outline-none"
        >
          {PROPOSAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-ink/40">{PARAMETER_HINTS[category]}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink/70">Target program (pubkey)</span>
        <input
          type="text"
          value={targetProgram}
          onChange={(e) => setTargetProgram(e.target.value)}
          className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm font-mono focus:border-lime/60 focus:outline-none"
          placeholder="Program ID..."
        />
        {targetProgram && !targetPubkey && (
          <span className="text-[10px] text-red-400">Invalid public key</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink/70">Metadata URI</span>
        <input
          type="text"
          value={metadataUri}
          onChange={(e) => setMetadataUri(e.target.value)}
          className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm focus:border-lime/60 focus:outline-none"
          placeholder="https://arweave.net/... or ipfs://..."
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink/70">Instruction data (hex, optional)</span>
        <textarea
          value={ixDataHex}
          onChange={(e) => setIxDataHex(e.target.value)}
          rows={2}
          className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm font-mono focus:border-lime/60 focus:outline-none resize-none"
          placeholder="deadbeef..."
        />
        {ixDataHex && !ixData && (
          <span className="text-[10px] text-red-400">Invalid hex</span>
        )}
      </label>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</p>
      )}

      {success && (
        <p className="text-xs text-lime bg-lime/10 rounded px-3 py-2">{success}</p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={handleSubmit}
          disabled={!valid || isPending}
          className="text-xs font-medium px-4 py-2 rounded bg-lime text-black hover:bg-lime/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Submitting...' : 'Submit proposal'}
        </button>
      </div>
    </div>
  );
}
