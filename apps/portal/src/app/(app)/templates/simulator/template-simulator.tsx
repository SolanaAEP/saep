'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { simulateTemplateEconomics } from '@saep/sdk-ui/template-simulator';
import type {
  SerializedTemplate,
  SerializedTemplateRegistryConfig,
} from '@/lib/template-serializer';
import {
  formatTemplateBps,
  formatTemplateRatePerDay,
  templateBestFor,
  templateCapabilityTags,
  templateLeaderboardHref,
  templateMarketplaceHref,
  templatePrimaryCapabilityLabel,
  templateTitle,
} from '@/lib/template-marketplace';

const LAMPORTS_PER_SOL = 1_000_000_000n;

function parseSolToLamports(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fractional = ''] = normalized.split('.');
  const wholeLamports = BigInt(whole || '0') * LAMPORTS_PER_SOL;
  const fractionalLamports = BigInt((fractional + '000000000').slice(0, 9));
  return wholeLamports + fractionalLamports;
}

function formatSol(lamports: string | bigint): string {
  const value = typeof lamports === 'bigint' ? lamports : BigInt(lamports || '0');
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = abs % LAMPORTS_PER_SOL;
  const shortFraction = fraction.toString().padStart(9, '0').replace(/0+$/, '').slice(0, 4);
  return `${sign}${whole.toLocaleString()}${shortFraction ? `.${shortFraction}` : ''} SOL`;
}

function pctFromBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function templateLabel(template: SerializedTemplate): string {
  const source = template.configUri || template.templateId;
  try {
    const url = new URL(source);
    return url.pathname.split('/').filter(Boolean).pop() ?? url.hostname;
  } catch {
    return source.length > 44 ? `${source.slice(0, 40)}...` : source;
  }
}

interface Props {
  templates: SerializedTemplate[];
  registry: SerializedTemplateRegistryConfig | null;
  initialTemplateId: string | null;
}

export function TemplateSimulator({ templates, registry, initialTemplateId }: Props) {
  const initialTemplate =
    templates.find((template) => template.templateId === initialTemplateId) ?? templates[0] ?? null;
  const [templateId, setTemplateId] = useState(initialTemplate?.templateId ?? 'custom');
  const selectedTemplate =
    templates.find((template) => template.templateId === templateId) ?? initialTemplate ?? null;
  const [tasksPerMonth, setTasksPerMonth] = useState('40');
  const [avgRewardSol, setAvgRewardSol] = useState('0.25');
  const [successRate, setSuccessRate] = useState('92');
  const [disputeRate, setDisputeRate] = useState('2');
  const [rentDurationDays, setRentDurationDays] = useState('30');
  const [forkSetupSol, setForkSetupSol] = useState('8');

  const royaltyBps = selectedTemplate?.royaltyBps ?? 500;
  const platformFeeBps = registry?.platformFeeBps ?? 200;
  const rentPricePerSecLamports = selectedTemplate?.rentPricePerSec ?? '0';
  const result = useMemo(
    () =>
      simulateTemplateEconomics({
        tasksPerMonth: Number(tasksPerMonth),
        avgRewardLamports: parseSolToLamports(avgRewardSol),
        successRateBps: Math.round(Number(successRate) * 100),
        disputeRateBps: Math.round(Number(disputeRate) * 100),
        royaltyBps,
        platformFeeBps,
        rentPricePerSecLamports,
        rentDurationDays: Number(rentDurationDays),
        forkSetupLamports: parseSolToLamports(forkSetupSol),
      }),
    [
      avgRewardSol,
      disputeRate,
      forkSetupSol,
      platformFeeBps,
      rentDurationDays,
      rentPricePerSecLamports,
      royaltyBps,
      successRate,
      tasksPerMonth,
    ],
  );

  const recommendationCopy = {
    rent: 'Rent first. The lease clears fixed costs better than a fork under this demand curve.',
    fork: 'Fork first. Expected volume can absorb setup cost better than a rental window.',
    wait: 'Wait. The current assumptions do not clear costs with a positive expected margin.',
  }[result.recommendation];
  const marketplaceHref = selectedTemplate ? templateMarketplaceHref(selectedTemplate) : null;
  const leaderboardHref = selectedTemplate ? templateLeaderboardHref(selectedTemplate) : null;
  const tags = selectedTemplate ? templateCapabilityTags(selectedTemplate) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <div className="flex flex-col gap-5">
        <div className="border border-ink/10 bg-paper p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Scenario Inputs
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink/55">
                Template
              </span>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="border border-ink/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime/40"
              >
                {templates.length === 0 ? <option value="custom">Custom template</option> : null}
                {templates.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {templateLabel(template)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Tasks / month" value={tasksPerMonth} onChange={setTasksPerMonth} />
              <NumberField label="Avg reward (SOL)" value={avgRewardSol} onChange={setAvgRewardSol} />
              <NumberField label="Success rate %" value={successRate} onChange={setSuccessRate} />
              <NumberField label="Dispute rate %" value={disputeRate} onChange={setDisputeRate} />
              <NumberField
                label="Rent duration days"
                value={rentDurationDays}
                onChange={setRentDurationDays}
              />
              <NumberField label="Fork setup SOL" value={forkSetupSol} onChange={setForkSetupSol} />
            </div>
          </div>
        </div>

        {selectedTemplate ? (
          <div className="border border-ink/10 bg-paper p-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Selected template
            </div>
            <h2 className="mt-3 font-display text-2xl tracking-tight">
              {templateTitle(selectedTemplate)}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">{templateBestFor(selectedTemplate)}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric
                label="Primary capability"
                value={templatePrimaryCapabilityLabel(selectedTemplate) ?? 'Mixed profile'}
              />
              <Metric
                label="Daily rent"
                value={formatTemplateRatePerDay(selectedTemplate.rentPricePerSec)}
              />
              <Metric label="Royalty" value={formatTemplateBps(selectedTemplate.royaltyBps)} tone="quiet" />
              <Metric label="Policy fee" value={pctFromBps(platformFeeBps)} tone="quiet" />
            </div>

            {tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="bg-ink/5 px-2 py-0.5 text-[10px] text-ink/70">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <MiniLink href={`/templates/${selectedTemplate.templateId}`}>Open detail</MiniLink>
              {marketplaceHref ? <MiniLink href={marketplaceHref}>Matching marketplace</MiniLink> : null}
              {leaderboardHref ? <MiniLink href={leaderboardHref}>Capability leaderboard</MiniLink> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div className="border border-ink/10 bg-ink p-5 text-paper">
          <div className="font-mono text-[10px] uppercase tracking-widest text-paper/55">
            Recommendation
          </div>
          <div className="mt-3 font-display text-3xl uppercase tracking-tight">
            {result.recommendation}
          </div>
          <p className="mt-2 max-w-2xl text-sm text-paper/70">{recommendationCopy}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Gross revenue" value={formatSol(result.grossRevenueLamports)} />
          <Metric label="Best net" value={formatSol(result.bestNetLamports)} />
          <Metric label="Margin" value={pctFromBps(result.marginBps)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Rent net" value={formatSol(result.rentNetLamports)} />
          <Metric label="Fork net" value={formatSol(result.forkNetLamports)} />
          <Metric label="Author revenue" value={formatSol(result.authorRevenueLamports)} />
          <Metric
            label="Break-even tasks"
            value={result.breakEvenTasks == null ? 'n/a' : result.breakEvenTasks.toLocaleString()}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Royalty" value={formatSol(result.royaltyCostLamports)} tone="quiet" />
          <Metric label="Rent cost" value={formatSol(result.rentCostLamports)} tone="quiet" />
          <Metric label="Platform fee" value={formatSol(result.platformFeeLamports)} tone="quiet" />
          <Metric label="Dispute loss" value={formatSol(result.disputeLossLamports)} tone="quiet" />
        </div>

        <div className="border border-ink/10 bg-paper-2 px-4 py-3 text-sm text-ink/60">
          Uses royalty {pctFromBps(royaltyBps)}, platform fee {pctFromBps(platformFeeBps)}, and
          rent price {formatSol(BigInt(rentPricePerSecLamports || '0') * 86_400n)} per day.
        </div>

        <div className="border border-ink/10 bg-paper px-4 py-4 text-sm text-ink/60">
          These defaults are deliberately builder-friendly rather than predictive. Use this to
          compare rent versus fork posture under one consistent demand shape, then adjust reward,
          success, dispute, and duration assumptions until the break-even story matches your lane.
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink/55">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border border-ink/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime/40"
      />
    </label>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'quiet';
}) {
  return (
    <div className={`border border-ink/10 p-4 ${tone === 'quiet' ? 'bg-paper-2' : 'bg-paper'}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 font-display text-xl tracking-tight">{value}</div>
    </div>
  );
}

function MiniLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center border border-ink/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink/70 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
    >
      {children}
    </Link>
  );
}
