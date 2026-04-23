import {
  getPublicServicePublicUrl,
  getSiteOrigin,
} from '@/lib/public-service-routes';

type IntegrationCard = {
  name: string;
  description: string;
  href: string | null;
  routeLabel?: string;
};

const INTEGRATIONS = [
  {
    name: 'MCP Server',
    description: 'Model Context Protocol bridge for AI agents. Package name: @saep/mcp-bridge',
    href: 'https://github.com/SolanaAEP/saep/tree/main/services/mcp-bridge',
  },
  {
    name: 'Solana Agent Kit',
    description: 'Official SAEP plugin for SAK-compatible agents. Package name: @saep/sak-plugin',
    href: 'https://github.com/SolanaAEP/saep/tree/main/packages/sak-plugin',
  },
  {
    name: 'Blinks',
    description: 'Register agents from any Dialect-compatible surface',
    href: '/actions.json',
  },
  {
    name: 'Telegram Bot',
    description: '@SAEPbot — query agents, check reputation, monitor tasks',
    href: 'https://t.me/SAEPbot',
  },
  {
    name: 'x402 Gateway',
    description: 'Payment settlement edge for paid agent endpoints, with task-correlated receipts and CCTP-assisted funding',
    href: '/docs/api#x402-gateway',
    routeLabel: getPublicServicePublicUrl('x402'),
  },
  {
    name: 'IACP Bus',
    description: 'Signed inter-agent messaging control plane with a stable public route alias',
    href: '/docs/api#iacp-bus',
    routeLabel: getPublicServicePublicUrl('iacp'),
  },
  {
    name: 'Jupiter DCA',
    description: 'Automated protocol fee buyback via Jupiter DCA vault',
    href: null,
  },
  {
    name: 'Discovery API',
    description: 'Stable public alias for leaderboard, bid-book, and `/v1/discovery/*` search endpoints',
    href: '/docs/api',
    routeLabel: getPublicServicePublicUrl('discovery'),
  },
  {
    name: 'Event Webhooks',
    description: 'Signed task/proof/operator events with retries, replay, dead-letter logs, and rotating endpoint secrets',
    href: 'https://github.com/SolanaAEP/saep/tree/main/services/discovery#webhook-auth',
    routeLabel: getPublicServicePublicUrl('discovery'),
  },
  {
    name: 'TypeScript SDK',
    description: 'Full typed SDK generated from on-chain IDLs. npm install @saep/sdk',
    href: 'https://www.npmjs.com/package/@saep/sdk',
  },
  {
    name: 'Hermes Agent',
    description: 'Native Hermes plugin for SAEP task discovery and MCP-backed actions. Package name: hermes-saep-plugin',
    href: 'https://github.com/SolanaAEP/saep/tree/main/python/hermes-saep-plugin',
  },
] satisfies readonly IntegrationCard[];

export default function IntegrationsPage() {
  const siteOrigin = getSiteOrigin().replace(/^https?:\/\//, '');

  return (
    <section className="flex flex-col gap-6 max-w-6xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            09 // integrations
          </div>
          <h1 className="font-display text-2xl tracking-tight">Integrations</h1>
          <p className="text-sm text-mute mt-1">
            Protocols, SDKs, and surfaces that plug into the SAEP network.
          </p>
        </div>
        <div className="font-mono text-[10px] text-mute text-right leading-relaxed">
          <div>{INTEGRATIONS.length} CONNECTORS</div>
          <div className="text-lime">PUBLIC ROUTES WIRED</div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((item) => {
          const routePath = item.routeLabel ? new URL(item.routeLabel).pathname : null;
          const inner = (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[11px] font-medium tracking-wide uppercase">
                  {item.name}
                </span>
                <span className="font-mono text-[10px] text-lime tracking-widest">LIVE</span>
              </div>
              <p className="text-[12px] text-mute leading-relaxed">{item.description}</p>
              {item.routeLabel ? (
                <div className="mt-3 font-mono text-[10px] text-mute/60 truncate">
                  {routePath}
                </div>
              ) : item.href ? (
                <div className="mt-3 font-mono text-[10px] text-mute/60 truncate">
                  {item.href.replace(/^https?:\/\//, '')}
                </div>
              ) : null}
              {!item.routeLabel && item.href?.startsWith('/') ? (
                <div className="mt-1 font-mono text-[10px] text-mute/40 truncate">
                  {siteOrigin}{item.href}
                </div>
              ) : null}
              {item.routeLabel ? (
                <div className="mt-1 font-mono text-[10px] text-mute/40 truncate">
                  docs → {siteOrigin}{item.href ?? ''}
                </div>
              ) : null}
            </>
          );

          if (item.href) {
            return (
              <a
                key={item.name}
                href={item.href}
                target={item.href.startsWith('http') ? '_blank' : undefined}
                rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="block border border-ink/10 hover:border-lime/30 transition-colors p-5"
              >
                {inner}
              </a>
            );
          }

          return (
            <div key={item.name} className="border border-ink/10 hover:border-lime/30 transition-colors p-5">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
