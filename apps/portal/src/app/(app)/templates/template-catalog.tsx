'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { CAPABILITY_LABELS } from '../dashboard/capability-tags';
import type { SerializedTemplate } from '@/lib/template-serializer';
import {
  formatTemplateBps,
  formatTemplateDuration,
  formatTemplateRatePerDay,
  formatTemplateRevenue,
  templateBestFor,
  templateCapabilityBits,
  templateCapabilityTags,
  templateFeaturedScore,
  templateLeaderboardHref,
  templateMarketplaceHref,
  templateMotion,
  templateMotionLabel,
  templatePrimaryCapabilityLabel,
  templateSignalLabel,
  templateSubtitle,
  templateTitle,
  templateUseCase,
} from '@/lib/template-marketplace';

const STATUS_ORDER = ['all', 'published', 'draft', 'deprecated', 'retired'] as const;
const MODEL_ORDER = ['all', 'fresh', 'rental', 'forked', 'hybrid'] as const;
const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'forks', label: 'Most forked' },
  { value: 'rentals', label: 'Most rented' },
  { value: 'cheapest', label: 'Lowest daily rent' },
] as const;

type StatusFilter = (typeof STATUS_ORDER)[number];
type ModelFilter = (typeof MODEL_ORDER)[number];
type SortMode = (typeof SORT_OPTIONS)[number]['value'];

interface Props {
  initialTemplates: SerializedTemplate[];
}

function shortKey(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function sortTemplates(templates: SerializedTemplate[], sortMode: SortMode): SerializedTemplate[] {
  const sorted = [...templates];
  sorted.sort((a, b) => {
    switch (sortMode) {
      case 'revenue':
        return Number(b.totalRevenue) - Number(a.totalRevenue) || b.updatedAt - a.updatedAt;
      case 'recent':
        return b.updatedAt - a.updatedAt || Number(b.totalRevenue) - Number(a.totalRevenue);
      case 'forks':
        return b.forkCount - a.forkCount || Number(b.totalRevenue) - Number(a.totalRevenue);
      case 'rentals':
        return b.rentCount - a.rentCount || Number(b.totalRevenue) - Number(a.totalRevenue);
      case 'cheapest':
        return Number(a.rentPricePerSec) - Number(b.rentPricePerSec) || b.updatedAt - a.updatedAt;
      case 'featured':
      default:
        return templateFeaturedScore(b) - templateFeaturedScore(a) || b.updatedAt - a.updatedAt;
    }
  });
  return sorted;
}

function modelMatches(template: SerializedTemplate, model: ModelFilter): boolean {
  return model === 'all' || templateMotion(template) === model;
}

function signalToneClass(template: SerializedTemplate): string {
  const label = templateSignalLabel(template);
  if (label === 'proven demand') return 'border-lime/30 bg-lime/10 text-lime';
  if (label === 'early traction') return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
  return 'border-ink/10 bg-ink/5 text-mute';
}

export function TemplateCatalog({ initialTemplates }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [model, setModel] = useState<ModelFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('featured');
  const [capabilityBit, setCapabilityBit] = useState<string>('all');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const capabilityOptions = useMemo(() => {
    const bits = new Set<number>();
    initialTemplates.forEach((template) => {
      templateCapabilityBits(template).forEach((bit) => bits.add(bit));
    });
    return [...bits].sort((a, b) => a - b);
  }, [initialTemplates]);

  const filtered = useMemo(() => {
    const filteredTemplates = initialTemplates
      .filter((template) => status === 'all' || template.status === status)
      .filter((template) => modelMatches(template, model))
      .filter((template) => {
        if (capabilityBit === 'all') return true;
        const requestedBit = Number(capabilityBit);
        return templateCapabilityBits(template).includes(requestedBit);
      })
      .filter((template) => {
        if (!deferredQuery) return true;
        const tags = templateCapabilityTags(template).join(' ').toLowerCase();
        return [
          template.templateId,
          template.author,
          template.configUri,
          templateTitle(template),
          templateSubtitle(template),
          templateBestFor(template),
          tags,
        ]
          .join(' ')
          .toLowerCase()
          .includes(deferredQuery);
      });
    return sortTemplates(filteredTemplates, sortMode);
  }, [capabilityBit, deferredQuery, initialTemplates, model, sortMode, status]);

  if (initialTemplates.length === 0) {
    return (
      <div className="border border-dashed border-ink/20 p-8 text-center">
        <p className="font-mono text-sm text-mute">NO TEMPLATES PUBLISHED YET</p>
        <p className="mt-2 text-sm text-mute">
          The registry is wired and ready. First templates will appear here as soon as they are
          minted on-chain.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 border border-ink/10 bg-paper p-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Search marketplace
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by template, capability, author, or use case"
              className="h-11 border border-ink/10 bg-transparent px-3 text-sm outline-none transition-colors focus:border-lime/40"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Sort
            </span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="h-11 border border-ink/10 bg-transparent px-3 text-sm outline-none transition-colors focus:border-lime/40"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Capability
            </span>
            <select
              value={capabilityBit}
              onChange={(event) => setCapabilityBit(event.target.value)}
              className="h-11 border border-ink/10 bg-transparent px-3 text-sm outline-none transition-colors focus:border-lime/40"
            >
              <option value="all">All capabilities</option>
              {capabilityOptions.map((bit) => (
                <option key={bit} value={bit}>
                  {CAPABILITY_LABELS[bit] ?? `bit ${bit}`}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Model
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value as ModelFilter)}
              className="h-11 border border-ink/10 bg-transparent px-3 text-sm outline-none transition-colors focus:border-lime/40"
            >
              <option value="all">All models</option>
              <option value="fresh">Fresh listings</option>
              <option value="rental">Rent-first</option>
              <option value="forked">Fork-first</option>
              <option value="hybrid">Rent + fork</option>
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-1">
            {STATUS_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`px-2.5 py-2 border font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  status === value
                    ? 'border-lime/40 bg-lime/10 text-lime'
                    : 'border-ink/10 text-mute hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2 border-t border-ink/10 pt-3 md:flex-row md:items-center md:justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          {filtered.length} template{filtered.length !== 1 ? 's' : ''} visible
        </div>
        <p className="max-w-3xl text-sm text-ink/60">
          Use templates as the fastest path from trust-ranked capability demand to a reusable agent
          starting point. Filter by capability, pick the economic model, then inspect or simulate
          before you fork.
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-ink/20 p-8 text-center">
          <p className="font-mono text-sm text-mute">NO TEMPLATES MATCH FILTER</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => {
            const tags = templateCapabilityTags(template);
            const marketplaceHref = templateMarketplaceHref(template);
            const leaderboardHref = templateLeaderboardHref(template);

            return (
              <article
                key={template.address}
                className="flex flex-col gap-4 border border-ink/10 bg-paper p-4 transition-colors hover:border-lime/40 hover:bg-ink/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display text-lg tracking-tight">{templateTitle(template)}</div>
                    <div className="mt-1 text-sm text-ink/55">{templateSubtitle(template)}</div>
                  </div>
                  <span className="border border-ink/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-mute">
                    {template.status}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${signalToneClass(template)}`}
                  >
                    {templateSignalLabel(template)}
                  </span>
                  <span className="rounded-full border border-ink/10 bg-paper-2 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-ink/65">
                    {templateMotionLabel(template)}
                  </span>
                  {templatePrimaryCapabilityLabel(template) ? (
                    <span className="rounded-full border border-ink/10 bg-paper-2 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-ink/65">
                      {templatePrimaryCapabilityLabel(template)}
                    </span>
                  ) : null}
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                    Best for
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink/70">{templateBestFor(template)}</p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink/45">
                    Use case: {templateUseCase(template)}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 border-t border-ink/10 pt-3 font-mono text-[11px]">
                  <div>
                    <div className="text-[9px] uppercase text-mute">Royalty</div>
                    <div>{formatTemplateBps(template.royaltyBps)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-mute">Daily rent</div>
                    <div>{formatTemplateRatePerDay(template.rentPricePerSec)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-mute">Revenue</div>
                    <div>{formatTemplateRevenue(template.totalRevenue)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border-t border-ink/10 pt-3 font-mono text-[11px]">
                  <div>
                    <div className="text-[9px] uppercase text-mute">Forks</div>
                    <div>{template.forkCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-mute">Rentals</div>
                    <div>{template.rentCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-mute">Window</div>
                    <div>
                      {formatTemplateDuration(template.minRentDuration)} -{' '}
                      {formatTemplateDuration(template.maxRentDuration)}
                    </div>
                  </div>
                </div>

                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="border border-ink/10 px-1.5 py-0.5 font-mono text-[9px] text-ink/70"
                      >
                        {tag}
                      </span>
                    ))}
                    {tags.length > 4 ? (
                      <span className="px-1.5 py-0.5 font-mono text-[9px] text-mute">
                        +{tags.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-auto flex items-center justify-between border-t border-ink/10 pt-3 font-mono text-[10px] text-mute">
                  <span>{shortKey(template.author)}</span>
                  <span>depth {template.lineageDepth}</span>
                </div>

                <div className="grid gap-2 pt-1">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ActionLink href={`/templates/${template.templateId}`} label="Inspect template" />
                    <ActionLink
                      href={`/templates/simulator?template=${template.templateId}`}
                      label="Simulate before deploy"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {marketplaceHref ? (
                      <ActionLink href={marketplaceHref} label="Open matching marketplace" subtle />
                    ) : (
                      <ActionGhost label="No capability route" />
                    )}
                    {leaderboardHref ? (
                      <ActionLink href={leaderboardHref} label="Open capability leaderboard" subtle />
                    ) : (
                      <ActionGhost label="No trust lens yet" />
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionLink({
  href,
  label,
  subtle = false,
}: {
  href: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center border px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        subtle
          ? 'border-ink/10 text-ink/65 hover:border-ink/25 hover:bg-ink/5 hover:text-ink'
          : 'border-lime/30 bg-lime/10 text-lime hover:border-lime/50 hover:bg-lime/15'
      }`}
    >
      {label}
    </Link>
  );
}

function ActionGhost({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center justify-center border border-dashed border-ink/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-mute">
      {label}
    </div>
  );
}
