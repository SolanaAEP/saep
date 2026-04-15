'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { encodeAgentId } from '@saep/sdk';
import { useRegisterAgent, useCluster } from '@saep/sdk-ui';

export default function RegisterAgentPage() {
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const register = useRegisterAgent();
  const router = useRouter();

  const [seed, setSeed] = useState('');
  const [manifestUri, setManifestUri] = useState('');
  const [capabilityMask, setCapabilityMask] = useState('1');
  const [priceSol, setPriceSol] = useState('0.01');
  const [streamRate, setStreamRate] = useState('0');
  const [stakeAmount, setStakeAmount] = useState('1000');
  const [stakeMint, setStakeMint] = useState(process.env.NEXT_PUBLIC_STAKE_MINT ?? '');
  const [operatorAta, setOperatorAta] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!publicKey) {
      setError('Connect wallet first');
      return;
    }
    try {
      const sig = await register.mutateAsync({
        agentId: encodeAgentId(seed),
        manifestUri,
        capabilityMask: BigInt(capabilityMask),
        priceLamports: BigInt(Math.round(Number(priceSol) * 1e9)),
        streamRate: BigInt(streamRate),
        stakeAmount: BigInt(stakeAmount),
        stakeMint: new PublicKey(stakeMint),
        operatorTokenAccount: new PublicKey(operatorAta),
        capabilityRegistryProgramId: cluster.programIds.capabilityRegistry,
      });
      console.log('registered', sig);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <section className="max-w-xl flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Register agent</h1>
        <p className="text-sm text-ink/60">Create a new agent on {cluster.cluster}.</p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 text-sm">
        <Field label="Agent seed (≤32 bytes)">
          <input required value={seed} onChange={(e) => setSeed(e.target.value)} className={input} />
        </Field>
        <Field label="Manifest URI">
          <input
            required
            value={manifestUri}
            onChange={(e) => setManifestUri(e.target.value)}
            placeholder="ipfs://… or https://…"
            className={input}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Capability mask (u128)">
            <input value={capabilityMask} onChange={(e) => setCapabilityMask(e.target.value)} className={input} />
          </Field>
          <Field label="Price (SOL)">
            <input value={priceSol} onChange={(e) => setPriceSol(e.target.value)} className={input} />
          </Field>
          <Field label="Stream rate (per sec, raw)">
            <input value={streamRate} onChange={(e) => setStreamRate(e.target.value)} className={input} />
          </Field>
          <Field label="Stake amount (raw)">
            <input value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Stake mint (Token-2022)">
          <input required value={stakeMint} onChange={(e) => setStakeMint(e.target.value)} className={input} />
        </Field>
        <Field label="Operator stake ATA">
          <input required value={operatorAta} onChange={(e) => setOperatorAta(e.target.value)} className={input} />
        </Field>

        {error ? <p className="text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={register.isPending}
          className="h-10 rounded bg-ink text-paper text-sm font-medium disabled:opacity-50"
        >
          {register.isPending ? 'Submitting…' : 'Register'}
        </button>
      </form>
    </section>
  );
}

const input = 'h-10 px-3 rounded border border-ink/15 bg-paper font-mono text-sm focus:outline-none focus:border-ink';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-ink/60">{label}</span>
      {children}
    </label>
  );
}
