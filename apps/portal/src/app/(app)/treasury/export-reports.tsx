'use client';

import { useState } from 'react';
import type { AgentSummary } from '@saep/sdk';
import { useAgentStreams, useAllowedMints, useVaultBalances, useTreasury } from '@saep/sdk-ui';

function didHex(d: Uint8Array): string {
  return Array.from(d).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportReports({ agent }: { agent: AgentSummary }) {
  const { data: treasury } = useTreasury(agent.did);
  const { data: mints } = useAllowedMints();
  const { data: balances } = useVaultBalances(agent.did, mints ?? []);
  const { data: streams } = useAgentStreams(agent.did);
  const [busy, setBusy] = useState<string | null>(null);

  function exportCsv() {
    setBusy('csv');
    const rows: string[][] = [['type', 'mint', 'amount', 'unit', 'counterparty', 'status', 'address']];

    (balances ?? []).forEach((b) => {
      rows.push([
        'balance',
        b.mint.toBase58(),
        b.amount.toString(),
        'base_units',
        '',
        b.exists ? 'vault' : 'missing',
        b.vault.toBase58(),
      ]);
    });

    (streams ?? []).forEach((s) => {
      rows.push([
        'stream_deposit',
        s.payerMint.toBase58(),
        s.depositTotal.toString(),
        'base_units',
        s.client.toBase58(),
        s.status,
        s.address.toBase58(),
      ]);
      rows.push([
        'stream_withdrawn',
        s.payoutMint.toBase58(),
        s.withdrawn.toString(),
        'base_units',
        s.client.toBase58(),
        s.status,
        s.address.toBase58(),
      ]);
    });

    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`saep-treasury-${didHex(agent.did).slice(0, 8)}.csv`, csv, 'text/csv');
    setBusy(null);
  }

  function exportJson() {
    setBusy('json');
    const payload = {
      agentDid: didHex(agent.did),
      operator: agent.operator.toBase58(),
      treasury: treasury
        ? {
            address: treasury.address.toBase58(),
            perTxLimit: treasury.perTxLimit.toString(),
            dailySpendLimit: treasury.dailySpendLimit.toString(),
            weeklyLimit: treasury.weeklyLimit.toString(),
            spentToday: treasury.spentToday.toString(),
            spentThisWeek: treasury.spentThisWeek.toString(),
            streamingActive: treasury.streamingActive,
          }
        : null,
      balances: (balances ?? []).map((b) => ({
        mint: b.mint.toBase58(),
        vault: b.vault.toBase58(),
        amount: b.amount.toString(),
        exists: b.exists,
      })),
      streams: (streams ?? []).map((s) => ({
        address: s.address.toBase58(),
        client: s.client.toBase58(),
        payerMint: s.payerMint.toBase58(),
        payoutMint: s.payoutMint.toBase58(),
        ratePerSec: s.ratePerSec.toString(),
        depositTotal: s.depositTotal.toString(),
        withdrawn: s.withdrawn.toString(),
        startTime: s.startTime,
        maxDuration: s.maxDuration,
        status: s.status,
      })),
      exportedAt: new Date().toISOString(),
    };
    download(
      `saep-treasury-${didHex(agent.did).slice(0, 8)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    setBusy(null);
  }

  const ready = Boolean(treasury && balances && streams);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Export reports</h2>
        <span className="text-[10px] text-ink/50">Client-side, no server call</span>
      </header>

      <div className="flex gap-2">
        <button
          onClick={exportCsv}
          disabled={!ready || busy !== null}
          className="text-xs px-3 py-1.5 border border-ink/10 hover:border-lime hover:text-lime transition-colors disabled:opacity-40"
        >
          {busy === 'csv' ? 'Generating…' : 'Download CSV'}
        </button>
        <button
          onClick={exportJson}
          disabled={!ready || busy !== null}
          className="text-xs px-3 py-1.5 border border-ink/10 hover:border-lime hover:text-lime transition-colors disabled:opacity-40"
        >
          {busy === 'json' ? 'Generating…' : 'Download JSON'}
        </button>
      </div>

      <p className="text-[10px] text-ink/40">
        PDF export lands with M2 reporting service. CSV/JSON include balances, streams, and limits
        as of the last on-chain read.
      </p>
    </div>
  );
}
