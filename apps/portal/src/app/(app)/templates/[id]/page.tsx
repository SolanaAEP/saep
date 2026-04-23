import {
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
} from '@saep/sdk';
import Link from 'next/link';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateFork,
  serializeTemplateRental,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
import { maskToTags } from '../../dashboard/capability-tags';

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

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatRatePerDay(ratePerSec: string): string {
  const perDay = Number(ratePerSec) * 86_400;
  if (!Number.isFinite(perDay)) return ratePerSec;
  return `${perDay.toLocaleString()} / day`;
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
    const tags = maskToTags(BigInt(template.capabilityMask));
    const configLink = normalizeUri(template.configUri);

    return (
      <section className="flex flex-col gap-6 max-w-5xl">
        <header className="flex flex-col gap-2 border-b border-ink/10 pb-6">
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase">
            template // {template.templateId.slice(0, 12)}
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl tracking-tight">
              {template.configUri || `Template ${template.templateId.slice(0, 8)}…`}
            </h1>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 border border-ink/10 text-mute">
              {template.status}
            </span>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-mono text-ink/50 break-all">{template.templateId}</p>
            <Link
              href={`/templates/simulator?template=${template.templateId}`}
              className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink transition-colors hover:border-lime/40 hover:bg-lime/10"
            >
              Simulate economics
            </Link>
          </div>
        </header>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <dt className="text-ink/50">Author</dt>
            <dd className="font-mono truncate">{template.author}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Royalty</dt>
            <dd>{formatBps(template.royaltyBps)}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Rent</dt>
            <dd className="font-mono">{formatRatePerDay(template.rentPricePerSec)}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Updated</dt>
            <dd>{formatDate(template.updatedAt)}</dd>
          </div>
        </dl>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/70">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="border border-ink/10 p-4 flex flex-col gap-4">
            <div>
              <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Config URI</div>
              {configLink ? (
                <a
                  href={configLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm mt-2 inline-flex items-center gap-2 hover:text-lime transition-colors break-all"
                >
                  {template.configUri}
                  <span className="font-mono text-[10px] text-mute">↗</span>
                </a>
              ) : (
                <p className="text-sm mt-2 break-all">{template.configUri || 'No config URI published'}</p>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-sm border-t border-ink/10 pt-4">
              <div>
                <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Rental Window</div>
                <div className="mt-1">
                  {formatDuration(template.minRentDuration)} - {formatDuration(template.maxRentDuration)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Parent Template</div>
                <div className="mt-1 font-mono break-all">
                  {template.parentTemplate ?? 'Original template'}
                </div>
              </div>
            </div>
          </div>

          <div className="border border-ink/10 p-4 flex flex-col gap-4">
            <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Registry Stats</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-ink/50">Forks</div>
                <div>{template.forkCount}</div>
              </div>
              <div>
                <div className="text-ink/50">Rentals</div>
                <div>{template.rentCount}</div>
              </div>
              <div>
                <div className="text-ink/50">Revenue</div>
                <div className="font-mono">{Number(template.totalRevenue).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-ink/50">Depth</div>
                <div>{template.lineageDepth}</div>
              </div>
            </div>
            {registry && (
              <div className="border-t border-ink/10 pt-4 text-sm">
                <div className="font-mono text-[10px] text-mute uppercase tracking-widest mb-2">
                  Policy
                </div>
                <div>Royalty cap: {formatBps(registry.royaltyCapBps)}</div>
                <div>Platform fee: {formatBps(registry.platformFeeBps)}</div>
                <div className="font-mono text-[11px] mt-2 break-all">
                  Escrow mint: {registry.rentEscrowMint}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="border border-ink/10">
            <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Fork lineage</div>
                <div className="text-sm mt-1">Agents forked from this template</div>
              </div>
              <div className="font-mono text-[10px] text-mute">{forks.length} forks</div>
            </div>
            {forks.length === 0 ? (
              <div className="p-4 text-sm text-mute">No forks recorded yet.</div>
            ) : (
              <div className="divide-y divide-ink/10">
                {forks.map((fork) => (
                  <div key={fork.address} className="px-4 py-3 text-sm flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] break-all">{fork.childAgentDid}</div>
                      <div className="text-mute text-xs mt-1">Forker {shortKey(fork.forker)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[11px]">{formatBps(fork.royaltyBpsSnapshot)}</div>
                      <div className="text-xs text-mute mt-1">{formatDate(fork.forkedAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-ink/10">
            <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Rental activity</div>
                <div className="text-sm mt-1">On-chain template rentals and revenue flow</div>
              </div>
              <div className="font-mono text-[10px] text-mute">{rentals.length} rentals</div>
            </div>
            {rentals.length === 0 ? (
              <div className="p-4 text-sm text-mute">No rentals recorded yet.</div>
            ) : (
              <div className="divide-y divide-ink/10">
                {rentals.map((rental) => (
                  <div key={rental.address} className="px-4 py-3 text-sm flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px]">{shortKey(rental.renter)}</div>
                      <div className="text-xs text-mute mt-1">
                        {formatDate(rental.startTime)} - {formatDate(rental.endTime)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[11px]">{Number(rental.prepaidAmount).toLocaleString()}</div>
                      <div className="text-xs text-mute mt-1 uppercase">{rental.status}</div>
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
      <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
        ERR: {(e as Error).message}
      </div>
    );
  }
}
