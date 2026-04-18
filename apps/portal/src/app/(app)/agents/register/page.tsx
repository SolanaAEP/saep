'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { encodeAgentId } from '@saep/sdk';
import { useRegisterAgent, useCluster } from '@saep/sdk-ui';
import type { WizardData } from './types';
import { StepIdentity } from './step-identity';
import { StepCapabilities } from './step-capabilities';
import { StepPricing } from './step-pricing';
import { StepStake } from './step-stake';
import { StepReview } from './step-review';

const STEPS = ['Identity', 'Capabilities', 'Pricing', 'Stake', 'Review'] as const;

const EMPTY: WizardData = {
  seed: '',
  manifestUri: '',
  selectedBits: new Set(),
  priceSol: '0.01',
  streamRate: '0',
  stakeAmount: '1000',
  stakeMint: process.env.NEXT_PUBLIC_STAKE_MINT ?? '',
  operatorAta: '',
};

export default function RegisterAgentPage() {
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const register = useRegisterAgent();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const capabilityMask = useMemo(() => {
    let mask = 0n;
    for (const bit of data.selectedBits) mask |= 1n << BigInt(bit);
    return mask;
  }, [data.selectedBits]);

  const patch = (partial: Partial<WizardData>) =>
    setData((prev) => ({ ...prev, ...partial }));

  const canAdvance = (): boolean => {
    switch (step) {
      case 0: return data.seed.length > 0 && data.manifestUri.length > 0;
      case 1: return data.selectedBits.size > 0;
      case 2: return Number(data.priceSol) > 0;
      case 3: return data.stakeMint.length > 0 && data.operatorAta.length > 0 && Number(data.stakeAmount) > 0;
      case 4: return true;
      default: return false;
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!publicKey) {
      setError('Connect wallet first');
      return;
    }
    try {
      await register.mutateAsync({
        agentId: encodeAgentId(data.seed),
        manifestUri: data.manifestUri,
        capabilityMask,
        priceLamports: BigInt(Math.round(Number(data.priceSol) * 1e9)),
        streamRate: BigInt(data.streamRate),
        stakeAmount: BigInt(data.stakeAmount),
        stakeMint: new PublicKey(data.stakeMint),
        operatorTokenAccount: new PublicKey(data.operatorAta),
        capabilityRegistryProgramId: cluster.programIds.capabilityRegistry,
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <section className="max-w-2xl flex flex-col gap-6">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          04 // agent onboarding
        </div>
        <h1 className="font-display text-2xl tracking-tight">Register agent</h1>
        <p className="text-sm text-mute mt-1">
          {cluster.cluster} · step {step + 1} of {STEPS.length}
        </p>
      </header>

      <StepIndicator steps={STEPS} current={step} />

      <div className="min-h-[280px]">
        {step === 0 && <StepIdentity data={data} patch={patch} />}
        {step === 1 && <StepCapabilities data={data} patch={patch} />}
        {step === 2 && <StepPricing data={data} patch={patch} />}
        {step === 3 && <StepStake data={data} patch={patch} />}
        {step === 4 && <StepReview data={data} mask={capabilityMask} />}
      </div>

      {error && (
        <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
          ERR: {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="font-mono text-[11px] h-10 px-5 border border-ink/20 text-mute hover:text-ink hover:border-ink/40 transition-colors"
          >
            Back
          </button>
        )}
        <div className="flex-1" />
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={!canAdvance()}
            onClick={() => setStep((s) => s + 1)}
            className="font-mono text-[11px] font-medium h-10 px-5 border border-ink text-ink hover:bg-ink hover:text-paper disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            disabled={register.isPending || !publicKey}
            onClick={onSubmit}
            className="font-mono text-[11px] font-medium h-10 px-5 border border-lime text-lime hover:bg-lime hover:text-black disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            {register.isPending ? 'Submitting…' : 'Register & sign'}
          </button>
        )}
      </div>
    </section>
  );
}

function StepIndicator({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <div className="flex items-center gap-1 text-xs font-mono">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink/20 mx-1">›</span>}
          <span
            className={
              i === current
                ? 'text-lime font-medium'
                : i < current
                  ? 'text-ink/60'
                  : 'text-ink/30'
            }
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
