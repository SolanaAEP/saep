'use client';

import { useMemo, useState } from 'react';
import type { AccountMeta } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import type { AgentSummary } from '@saep/sdk';
import { DEFAULT_YIELD_STRATEGIES } from '@saep/sdk';
import {
  useDepositToYieldStrategy,
  useEmergencyUnwindYieldStrategy,
  useIndexedTreasuryYield,
  useIndexedTreasuryYieldPositions,
  useIndexedYieldStrategies,
  useRequestTreasuryYieldUnwind,
  useSetTreasuryYieldConfig,
  useTreasuryYieldResearch,
  useWithdrawFromYieldStrategy,
} from '@saep/sdk-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { getPortalIndexerUrl } from '@/lib/indexer-url';

const BADGES = {
  live: 'bg-lime/10 text-lime border-lime/20',
  next: 'bg-lime/10 text-lime border-lime/20',
  research: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  deferred: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
} as const;

const RISK = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
} as const;

const INDEXER_URL = getPortalIndexerUrl();
type RouteAction = 'deposit' | 'withdraw' | 'emergency_unwind';

function formatUsdMicro(value: bigint): string {
  return `$${(Number(value) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRawAmount(value: string | null | undefined): string {
  if (!value) return '0';
  return BigInt(value).toLocaleString();
}

function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected even-length hex');
  }
  return Uint8Array.from(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
}

function parseRouteAccounts(json: string): AccountMeta[] {
  const trimmed = json.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as Array<{
    pubkey: string;
    isSigner?: boolean;
    isWritable?: boolean;
  }>;
  if (!Array.isArray(parsed)) throw new Error('Route accounts must be a JSON array');
  return parsed.map((account) => ({
    pubkey: new PublicKey(account.pubkey),
    isSigner: Boolean(account.isSigner),
    isWritable: Boolean(account.isWritable),
  }));
}

export function YieldAutomationPanel({ agent }: { agent: AgentSummary }) {
  const { connected } = useWallet();
  const research = useTreasuryYieldResearch(agent.did);
  const didHex = Buffer.from(agent.did).toString('hex');
  const indexedYield = useIndexedTreasuryYield({ indexerUrl: INDEXER_URL, agentDidHex: didHex });
  const indexedPositions = useIndexedTreasuryYieldPositions({ indexerUrl: INDEXER_URL, agentDidHex: didHex });
  const indexedStrategies = useIndexedYieldStrategies({ indexerUrl: INDEXER_URL, venue: 'kamino', limit: 10 });
  const [allocationBps, setAllocationBps] = useState('2500');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawReceiptAmount, setWithdrawReceiptAmount] = useState('');
  const [routeDataHex, setRouteDataHex] = useState('');
  const [routeAccountsJson, setRouteAccountsJson] = useState('');
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [routePreparing, setRoutePreparing] = useState(false);

  const setConfig = useSetTreasuryYieldConfig();
  const requestUnwind = useRequestTreasuryYieldUnwind();
  const deposit = useDepositToYieldStrategy();
  const withdraw = useWithdrawFromYieldStrategy();
  const emergencyUnwind = useEmergencyUnwindYieldStrategy();

  const activeKaminoStrategy = useMemo(
    () => (indexedStrategies.data ?? []).find((strategy) => strategy.status === 'active') ?? null,
    [indexedStrategies.data],
  );
  const controlPlaneStatus = indexedYield.data?.status ?? 'not configured';
  const routeReady = routeDataHex.trim().length > 0;
  const mutationBusy =
    setConfig.isPending || requestUnwind.isPending || deposit.isPending || withdraw.isPending || emergencyUnwind.isPending;

  async function runMutation(label: string, fn: () => Promise<string>) {
    setFormError(null);
    setLastSignature(null);
    try {
      const sig = await fn();
      setLastSignature(`${label}: ${sig}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function prepareKaminoRoute(action: RouteAction, amountRaw?: string) {
    setFormError(null);
    setRouteNotice(null);
    if (!activeKaminoStrategy) {
      setFormError('No active Kamino strategy is indexed yet');
      return;
    }
    if (action !== 'emergency_unwind' && (!amountRaw || !/^[1-9][0-9]*$/.test(amountRaw))) {
      setFormError('Enter a positive integer amount before preparing the Kamino route');
      return;
    }
    setRoutePreparing(true);
    try {
      const res = await fetch('/api/treasury/kamino-route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          agentDidHex: didHex,
          strategyIdHex: activeKaminoStrategy.strategyIdHex,
          underlyingMint: activeKaminoStrategy.underlyingMint,
          receiptMint: activeKaminoStrategy.receiptMint,
          strategyProgram: activeKaminoStrategy.strategyProgram,
          amountRaw,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { routeDataHex?: string; routeAccounts?: unknown; error?: string; guidance?: string }
        | null;
      if (!res.ok || !payload?.routeDataHex || !Array.isArray(payload.routeAccounts)) {
        throw new Error(payload?.guidance ?? payload?.error ?? 'Unable to prepare Kamino route');
      }
      setRouteDataHex(payload.routeDataHex);
      setRouteAccountsJson(JSON.stringify(payload.routeAccounts, null, 2));
      setRouteNotice('Kamino route prepared. Review the generated accounts, then submit the wallet transaction.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutePreparing(false);
    }
  }

  function movementInput() {
    if (!activeKaminoStrategy) throw new Error('No active Kamino strategy is indexed yet');
    return {
      agentDid: agent.did,
      strategyId: bytesFromHex(activeKaminoStrategy.strategyIdHex),
      mint: new PublicKey(activeKaminoStrategy.underlyingMint),
      receiptMint: new PublicKey(activeKaminoStrategy.receiptMint),
      kaminoProgram: new PublicKey(activeKaminoStrategy.strategyProgram),
      routeData: bytesFromHex(routeDataHex),
      routeAccounts: parseRouteAccounts(routeAccountsJson),
    };
  }

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Kamino yield automation</h2>
          <p className="text-[11px] text-ink/50 mt-1">
            Configure a governance-approved Kamino strategy, deploy idle treasury USDC through the
            constrained adapter, and track deployed principal, receipt balance, realized yield, and unwind state.
          </p>
        </div>
        <span className="text-[10px] text-ink/40 font-mono uppercase tracking-[0.08em]">
          Kamino live
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            idle stable balance
          </div>
          <div className="mt-2 text-lg font-medium">
            {research.isLoading ? 'Loading…' : formatUsdMicro(research.data.snapshot.idleUsdMicro)}
          </div>
        </div>
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            deployable now
          </div>
          <div className="mt-2 text-lg font-medium">
            {research.isLoading ? 'Loading…' : formatUsdMicro(research.data.deployableUsdMicro)}
          </div>
        </div>
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            live venue
          </div>
          <div className="mt-2 text-lg font-medium">
            {activeKaminoStrategy ? activeKaminoStrategy.name : 'Awaiting strategy'}
          </div>
        </div>
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            indexed state
          </div>
          <div className="mt-2 text-lg font-medium capitalize">
            {indexedYield.isLoading ? 'Loading…' : controlPlaneStatus}
          </div>
        </div>
      </div>

      {indexedYield.data ? (
        <div className="border border-lime/20 bg-lime/5 p-3 text-[11px] text-ink/70">
          Indexed yield config: {(indexedYield.data.allocationBps / 100).toFixed(2)}% allocation,
          deployed {formatRawAmount(indexedYield.data.deployedAmount)}, realized yield{' '}
          {formatRawAmount(indexedYield.data.realizedYieldAmount)}. Strategy{' '}
          <span className="font-mono">{indexedYield.data.strategyIdHex.slice(0, 12)}…</span>.
        </div>
      ) : (
        <div className="border border-ink/10 bg-paper/60 p-3 text-[11px] text-ink/60">
          No indexed yield config for this treasury yet. Choose the active Kamino strategy and set an
          allocation cap before depositing.
        </div>
      )}

      <section className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="border border-ink/10 p-4 flex flex-col gap-3">
          <h3 className="text-xs font-medium">1. Configure allocation</h3>
          <label className="text-[11px] text-ink/60 flex flex-col gap-1">
            Allocation bps
            <input
              value={allocationBps}
              onChange={(event) => setAllocationBps(event.target.value)}
              className="border border-ink/10 bg-paper px-3 py-2 font-mono text-xs"
              placeholder="2500"
            />
          </label>
          <button
            type="button"
            disabled={!connected || !activeKaminoStrategy || mutationBusy}
            onClick={() =>
              runMutation('configured', () =>
                setConfig.mutateAsync({
                  agentDid: agent.did,
                  strategyId: bytesFromHex(activeKaminoStrategy!.strategyIdHex),
                  allocationBps: Number(allocationBps),
                }),
              )
            }
            className="border border-lime/30 bg-lime/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
          >
            Set Kamino allocation
          </button>
          <button
            type="button"
            disabled={!connected || mutationBusy}
            onClick={() =>
              runMutation('unwind requested', () => requestUnwind.mutateAsync({ agentDid: agent.did }))
            }
            className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
          >
            Request treasury unwind
          </button>
        </div>

        <div className="border border-ink/10 p-4 flex flex-col gap-3">
          <h3 className="text-xs font-medium">2. Execute Kamino movement</h3>
          <p className="text-[11px] text-ink/55 leading-relaxed">
            Use the configured Kamino route builder to prepare the exact instruction data and account
            metas, then submit through SAEP. Manual route fields stay visible for devnet verification
            and controlled operator runs.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] text-ink/60 flex flex-col gap-1">
              Deposit amount
              <input
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                className="border border-ink/10 bg-paper px-3 py-2 font-mono text-xs"
                placeholder="1000000"
              />
            </label>
            <label className="text-[11px] text-ink/60 flex flex-col gap-1">
              Withdraw receipt amount
              <input
                value={withdrawReceiptAmount}
                onChange={(event) => setWithdrawReceiptAmount(event.target.value)}
                className="border border-ink/10 bg-paper px-3 py-2 font-mono text-xs"
                placeholder="1000000"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={!activeKaminoStrategy || !depositAmount || mutationBusy || routePreparing}
              onClick={() => prepareKaminoRoute('deposit', depositAmount)}
              className="border border-lime/30 bg-lime/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Prepare deposit route
            </button>
            <button
              type="button"
              disabled={!activeKaminoStrategy || !withdrawReceiptAmount || mutationBusy || routePreparing}
              onClick={() => prepareKaminoRoute('withdraw', withdrawReceiptAmount)}
              className="border border-ink/20 bg-paper px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Prepare withdraw route
            </button>
            <button
              type="button"
              disabled={!activeKaminoStrategy || mutationBusy || routePreparing}
              onClick={() => prepareKaminoRoute('emergency_unwind')}
              className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Prepare unwind route
            </button>
          </div>
          <label className="text-[11px] text-ink/60 flex flex-col gap-1">
            Route data hex
            <textarea
              value={routeDataHex}
              onChange={(event) => setRouteDataHex(event.target.value)}
              className="min-h-20 border border-ink/10 bg-paper px-3 py-2 font-mono text-[11px]"
              placeholder="hex encoded Kamino instruction data"
            />
          </label>
          <label className="text-[11px] text-ink/60 flex flex-col gap-1">
            Route account metas JSON
            <textarea
              value={routeAccountsJson}
              onChange={(event) => setRouteAccountsJson(event.target.value)}
              className="min-h-20 border border-ink/10 bg-paper px-3 py-2 font-mono text-[11px]"
              placeholder='[{"pubkey":"...","isWritable":true,"isSigner":false}]'
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={!connected || !routeReady || !depositAmount || mutationBusy}
              onClick={() =>
                runMutation('deposited', () =>
                  deposit.mutateAsync({ ...movementInput(), amount: BigInt(depositAmount) }),
                )
              }
              className="border border-lime/30 bg-lime/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Deposit to Kamino
            </button>
            <button
              type="button"
              disabled={!connected || !routeReady || !withdrawReceiptAmount || mutationBusy}
              onClick={() =>
                runMutation('withdrawn', () =>
                  withdraw.mutateAsync({ ...movementInput(), receiptAmount: BigInt(withdrawReceiptAmount) }),
                )
              }
              className="border border-ink/20 bg-paper px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Withdraw
            </button>
            <button
              type="button"
              disabled={!connected || !routeReady || mutationBusy}
              onClick={() =>
                runMutation('emergency unwind', () => emergencyUnwind.mutateAsync(movementInput()))
              }
              className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Emergency unwind
            </button>
          </div>
        </div>
      </section>

      {formError ? (
        <div className="border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-500">
          {formError}
        </div>
      ) : null}
      {routeNotice ? (
        <div className="border border-lime/20 bg-lime/5 p-3 text-[11px] text-ink/70">
          {routeNotice}
        </div>
      ) : null}
      {lastSignature ? (
        <div className="border border-lime/20 bg-lime/5 p-3 text-[11px] text-ink/70 font-mono">
          {lastSignature}
        </div>
      ) : null}

      {(indexedPositions.data ?? []).length > 0 ? (
        <div className="border border-ink/10 divide-y divide-ink/10">
          {(indexedPositions.data ?? []).map((position) => (
            <div key={`${position.strategyIdHex}-${position.vaultMint}`} className="px-4 py-3 grid gap-2 sm:grid-cols-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
                  position
                </div>
                <div className="text-xs font-medium capitalize">{position.status}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
                  principal
                </div>
                <div className="text-xs font-mono">{formatRawAmount(position.principalAmount)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
                  receipt balance
                </div>
                <div className="text-xs font-mono">{formatRawAmount(position.receiptAmount)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
                  realized yield
                </div>
                <div className="text-xs font-mono">{formatRawAmount(position.realizedYieldAmount)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {research.data.positions.length > 0 ? (
        <div className="border border-ink/10 divide-y divide-ink/10">
          {research.data.positions.map((position) => (
            <div key={position.mint.toBase58()} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em]">
                  {position.symbol}
                </div>
                <div className="text-[10px] text-ink/45">{position.mint.toBase58()}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px]">{position.rawAmount.toString()}</div>
                <div className="text-[10px] text-ink/45">
                  {position.stableUsd ? formatUsdMicro(position.usdMicro) : 'future venue collateral'}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {research.data.blockedReasons.length > 0 ? (
        <div className="border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-ink/70">
          Blocked today: {research.data.blockedReasons.join(' · ')}
        </div>
      ) : null}

      <div className="grid gap-3">
        {(indexedStrategies.data ?? []).map((strategy) => (
          <article key={strategy.strategyIdHex} className="border border-lime/20 bg-lime/5 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/60">
                  {strategy.venue}
                </div>
                <h3 className="text-sm font-medium">{strategy.name}</h3>
              </div>
              <span className="inline-flex items-center border rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] bg-lime/10 text-lime border-lime/20">
                {strategy.status}
              </span>
            </div>
            <p className="text-xs text-ink/70 leading-relaxed">
              Approved live strategy capped at {(strategy.maxAllocationBps / 100).toFixed(2)}%
              allocation. Metadata: {strategy.metadataUri || 'none'}
            </p>
            <div className="flex flex-wrap gap-3 text-[10px] font-mono text-ink/45 uppercase tracking-[0.08em]">
              <span>risk: {strategy.riskTier}</span>
              <span>underlying: {strategy.underlyingMint.slice(0, 8)}…</span>
              <span>receipt: {strategy.receiptMint.slice(0, 8)}…</span>
            </div>
          </article>
        ))}
        {DEFAULT_YIELD_STRATEGIES.filter((strategy) => strategy.venue !== 'kamino').map((strategy) => (
          <article key={strategy.id} className="border border-ink/10 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/60">
                  {strategy.venue}
                </div>
                <h3 className="text-sm font-medium">{strategy.label}</h3>
              </div>
              <span
                className={`inline-flex items-center border rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${BADGES[strategy.lifecycle]}`}
              >
                future
              </span>
            </div>
            <p className="text-xs text-ink/70 leading-relaxed">{strategy.summary}</p>
            <div className="flex flex-wrap gap-3 text-[10px] font-mono text-ink/45 uppercase tracking-[0.08em]">
              <span>risk: {RISK[strategy.riskTier]}</span>
              <span>mints: {strategy.allowedMints.join(', ')}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
