'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import type { SerializedTemplate } from '@/lib/template-serializer';
import { maskToTags } from '../dashboard/capability-tags';

const STATUS_ORDER = ['all', 'published', 'draft', 'deprecated', 'retired'] as const;

function shortKey(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatRatePerDay(ratePerSec: string): string {
  const perDay = Number(ratePerSec) * 86_400;
  if (!Number.isFinite(perDay)) return 'n/a';
  return `${perDay.toLocaleString()} / day`;
}

function formatRevenue(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString();
}

interface Props {
  initialTemplates: SerializedTemplate[];
}

export function TemplateCatalog({ initialTemplates }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_ORDER)[number]>('all');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filtered = useMemo(() => {
    return initialTemplates
      .filter((template) => status === 'all' || template.status === status)
      .filter((template) => {
        if (!deferredQuery) return true;
        return (
          template.templateId.includes(deferredQuery) ||
          template.author.toLowerCase().includes(deferredQuery) ||
          template.configUri.toLowerCase().includes(deferredQuery)
        );
      })
      .sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue) || b.updatedAt - a.updatedAt);
  }, [deferredQuery, initialTemplates, status]);

  if (initialTemplates.length === 0) {
    return (
      <div className="border border-dashed border-ink/20 p-8 text-center">
        <p className="font-mono text-sm text-mute">NO TEMPLATES PUBLISHED YET</p>
        <p className="text-sm text-mute mt-2">
          The registry is wired and ready. First templates will appear here as soon as they are minted on-chain.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-[10px] text-mute uppercase tracking-widest">
            Search Registry
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by template id, author, or config URI"
            className="border border-ink/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime/40"
          />
        </label>
        <div className="flex flex-wrap gap-2 items-end">
          {STATUS_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`px-2.5 py-2 border font-mono text-[10px] uppercase tracking-widest transition-colors ${
                status === value
                  ? 'border-lime/40 bg-lime/10 text-lime'
                  : 'border-ink/10 text-mute hover:text-ink hover:bg-ink/5'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="font-mono text-[10px] text-mute border-t border-ink/10 pt-3">
        {filtered.length} TEMPLATE{filtered.length !== 1 ? 'S' : ''} VISIBLE
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-ink/20 p-8 text-center">
          <p className="font-mono text-sm text-mute">NO TEMPLATES MATCH FILTER</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => {
            const tags = maskToTags(BigInt(template.capabilityMask));

            return (
              <Link
                key={template.address}
                href={`/templates/${template.templateId}`}
                className="group border border-ink/10 p-4 flex flex-col gap-4 hover:border-lime/40 hover:bg-ink/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display text-lg tracking-tight truncate">
                      {template.configUri || `Template ${template.templateId.slice(0, 8)}`}
                    </div>
                    <div className="font-mono text-[10px] text-mute mt-1">
                      {template.templateId.slice(0, 16)}…
                    </div>
                  </div>
                  <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 border border-ink/10 text-mute">
                    {template.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 font-mono text-[11px] border-t border-ink/10 pt-3">
                  <div>
                    <div className="text-[9px] text-mute uppercase">Royalty</div>
                    <div>{formatBps(template.royaltyBps)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-mute uppercase">Rent</div>
                    <div>{formatRatePerDay(template.rentPricePerSec)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-mute uppercase">Revenue</div>
                    <div>{formatRevenue(template.totalRevenue)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 font-mono text-[11px] border-t border-ink/10 pt-3">
                  <div>
                    <div className="text-[9px] text-mute uppercase">Forks</div>
                    <div>{template.forkCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-mute uppercase">Rentals</div>
                    <div>{template.rentCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-mute uppercase">Window</div>
                    <div>{formatDuration(template.minRentDuration)} - {formatDuration(template.maxRentDuration)}</div>
                  </div>
                </div>

                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="font-mono text-[9px] px-1.5 py-0.5 border border-ink/10 text-ink/70">
                        {tag}
                      </span>
                    ))}
                    {tags.length > 4 && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 text-mute">+{tags.length - 4}</span>
                    )}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between font-mono text-[10px] text-mute border-t border-ink/10 pt-3">
                  <span>{shortKey(template.author)}</span>
                  <span>depth {template.lineageDepth}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
