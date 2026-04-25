import {
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
} from '@saep/sdk';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateFork,
  serializeTemplateRental,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
import {
  formatTemplateBps,
  formatTemplateDuration,
  formatTemplateRatePerDay,
  formatTemplateRevenue,
  templateBestFor,
  templateCapabilityTags,
  templateLeaderboardHref,
  templateMarketplaceHref,
  templateMotionLabel,
  templatePrimaryCapabilityLabel,
  templateSignalLabel,
  templateSubtitle,
  templateTitle,
  templateUseCase,
} from '@/lib/template-marketplace';

function shortKey(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeUri(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
  return null;
}

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id.length !== 64) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight">Template not found</h1>
        <p className="font-mono text-[11px] text-mute">Expected a 32-byte template id.</p>
      </div>
    );
  }

  try {
    const program = getTemplateRegistryProgram();
    const rawTemplate = await fetchTemplateById(program, id);

    if (!rawTemplate) {
      return (
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl tracking-tight">Template not found</h1>
          <p className="font-mono text-[11px] text-mute">
            No template with id {id.slice(0, 16)}…
          </p>
        </div>
      );
    }

    const [rawRegistry, rawForks, rawRentals] = await Promise.all([
      fetchTemplateRegistryConfig(program),
      fetchTemplateForks(program, rawTemplate.address),
      fetchTemplateRentals(program, rawTemplate.address),
    ]);

    const template = serializeTemplate(rawTemplate);
    const registry = rawRegistry ? serializeTemplateRegistryConfig(rawRegistry) : null;
    const forks = rawForks.map(serializeTemplateFork);
    const rentals = rawRentals.map(serializeTemplateRental);
    const tags = templateCapabilityTags(template);
    const configLink = normalizeUri(template.configUri);
    const marketplaceHref = templateMarketplaceHref(template);
    const leaderboardHref = templateLeaderboardHref(template);

    return (
      <section className="flex max-w-6xl flex-col gap-6">
        <header className="border-b border-ink/10 pb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            template // {template.templateId.slice(0, 12)}
          </div>
          <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-3xl tracking-tight">{templateTitle(template)}</h1>
              <p className="mt-2 text-sm text-ink/55">{templateSubtitle(template)}</p>
              <p className="mt-4 text-sm leading-6 text-ink/70">{templateBestFor(template)}</p>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
              <Badge>{template.status}</Badge>
              <Badge>{templateSignalLabel(template)}</Badge>
              <Badge>{templateMotionLabel(template)}</Badge>
              {templatePrimaryCapabilityLabel(template) ? (
                <Badge>{templatePrimaryCapabilityLabel(template)}</Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="break-all font-mono text-[11px] text-ink/50">{template.templateId}</p>
            <div className="flex flex-wrap gap-2">
              <ActionLink href={`/templates/${template.templateId}/rent`} emphasis>
                Rent template
              </ActionLink>
              <ActionLink href={`/templates/${template.templateId}/fork`}>
                Link fork
              </ActionLink>
              <ActionLink href={`/templates/simulator?template=${template.templateId}`} emphasis>
                Simulate economics
              </ActionLink>
              {marketplaceHref ? (
                <ActionLink href={marketplaceHref}>Open matching marketplace</ActionLink>
              ) : null}
              {leaderboardHref ? (
                <ActionLink href={leaderboardHref}>Open capability leaderboard</ActionLink>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Primary use case" value={templateUseCase(template)} />
          <SummaryCard label="Royalty" value={formatTemplateBps(template.royaltyBps)} />
          <SummaryCard label="Daily rent" value={formatTemplateRatePerDay(template.rentPricePerSec)} />
          <SummaryCard label="Recorded revenue" value={formatTemplateRevenue(template.totalRevenue)} />
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="bg-ink/5 px-2 py-0.5 text-[10px] text-ink/70">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border border-ink/10 bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Builder path
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <PathStep
                eyebrow="1 // inspect"
                title="Check the capability fit"
                description="Use the capability tags and trust links to confirm this template maps cleanly to live demand."
              />
              <PathStep
                eyebrow="2 // simulate"
                title="Stress the economics"
                description="Model fork setup cost, rent duration, reward size, and dispute pressure before you commit."
              />
              <PathStep
                eyebrow="3 // launch"
                title="Choose rent or fork"
                description="Use rent-first when you want low-friction validation, or fork-first when you need a durable custom branch."
              />
            </div>
          </div>

          <div className="border border-ink/10 bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Registry stats
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <StatPair label="Forks" value={String(template.forkCount)} />
              <StatPair label="Rentals" value={String(template.rentCount)} />
              <StatPair label="Lineage depth" value={String(template.lineageDepth)} />
              <StatPair label="Updated" value={formatDate(template.updatedAt)} />
            </div>
            {registry ? (
              <div className="mt-4 border-t border-ink/10 pt-4 text-sm">
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Policy rails
                </div>
                <div className="mt-2">Royalty cap: {formatTemplateBps(registry.royaltyCapBps)}</div>
                <div>Platform fee: {formatTemplateBps(registry.platformFeeBps)}</div>
                <div className="mt-2 break-all font-mono text-[11px]">
                  Escrow mint: {registry.rentEscrowMint}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border border-ink/10 bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Config URI</div>
            {configLink ? (
              <a
                href={configLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-2 break-all text-sm transition-colors hover:text-lime"
              >
                {template.configUri}
                <span className="font-mono text-[10px] text-mute">↗</span>
              </a>
            ) : (
              <p className="mt-2 break-all text-sm">{template.configUri || 'No config URI published'}</p>
            )}

            <div className="mt-4 grid gap-4 border-t border-ink/10 pt-4 sm:grid-cols-2 text-sm">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Rental window
                </div>
                <div className="mt-1">
                  {formatTemplateDuration(template.minRentDuration)} -{' '}
                  {formatTemplateDuration(template.maxRentDuration)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Parent template
                </div>
                <div className="mt-1 break-all font-mono text-[11px]">
                  {template.parentTemplate ?? 'Original template'}
                </div>
              </div>
            </div>
          </div>

          <div className="border border-ink/10 bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Template fit snapshot
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <SnapshotRow
                label="Use this when"
                value={templateBestFor(template)}
              />
              <SnapshotRow
                label="Capability focus"
                value={templatePrimaryCapabilityLabel(template) ?? 'Mixed capability profile'}
              />
              <SnapshotRow
                label="Commercial motion"
                value={`${templateMotionLabel(template)} with ${templateSignalLabel(template)}`}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="border border-ink/10">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Fork lineage
                </div>
                <div className="mt-1 text-sm">Agents forked from this template</div>
              </div>
              <div className="font-mono text-[10px] text-mute">{forks.length} forks</div>
            </div>
            {forks.length === 0 ? (
              <div className="p-4 text-sm text-mute">No forks recorded yet.</div>
            ) : (
              <div className="divide-y divide-ink/10">
                {forks.map((fork) => (
                  <div key={fork.address} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="break-all font-mono text-[11px]">{fork.childAgentDid}</div>
                      <div className="mt-1 text-xs text-mute">Forker {shortKey(fork.forker)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[11px]">{formatTemplateBps(fork.royaltyBpsSnapshot)}</div>
                      <div className="mt-1 text-xs text-mute">{formatDate(fork.forkedAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-ink/10">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Rental activity
                </div>
                <div className="mt-1 text-sm">On-chain rentals and revenue flow</div>
              </div>
              <div className="font-mono text-[10px] text-mute">{rentals.length} rentals</div>
            </div>
            {rentals.length === 0 ? (
              <div className="p-4 text-sm text-mute">No rentals recorded yet.</div>
            ) : (
              <div className="divide-y divide-ink/10">
                {rentals.map((rental) => (
                  <div key={rental.address} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px]">{shortKey(rental.renter)}</div>
                      <div className="mt-1 text-xs text-mute">
                        {formatDate(rental.startTime)} - {formatDate(rental.endTime)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[11px]">
                        {formatTemplateRevenue(rental.prepaidAmount)}
                      </div>
                      <div className="mt-1 text-xs uppercase text-mute">{rental.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  } catch (e) {
    return (
      <div className="border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
        ERR: {(e as Error).message}
      </div>
    );
  }
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="border border-ink/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
      {children}
    </span>
  );
}

function ActionLink({
  href,
  children,
  emphasis = false,
}: {
  href: string;
  children: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center border px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        emphasis
          ? 'border-lime/30 bg-lime/10 text-lime hover:border-lime/50 hover:bg-lime/15'
          : 'border-ink/15 text-ink hover:border-ink/30 hover:bg-ink/5'
      }`}
    >
      {children}
    </Link>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/10 bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 font-display text-xl tracking-tight">{value}</div>
    </div>
  );
}

function PathStep({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{eyebrow}</div>
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      <p className="text-sm leading-6 text-ink/65">{description}</p>
    </div>
  );
}

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-ink/50">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/10 bg-paper-2 px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <p className="mt-2 text-sm leading-6 text-ink/70">{value}</p>
    </div>
  );
}
