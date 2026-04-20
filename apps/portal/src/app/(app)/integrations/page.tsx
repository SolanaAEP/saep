const INTEGRATIONS = [
  {
    name: 'MCP Server',
    description: 'Model Context Protocol bridge for AI agents. npm install @saep/mcp-server',
    href: 'https://www.npmjs.com/package/@saep/mcp-server',
  },
  {
    name: 'Solana Agent Kit',
    description: '7 on-chain actions for SAK-compatible agents',
    href: 'https://www.npmjs.com/package/@saep/solana-agent-kit',
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
    description: 'RFC 9452 payment settlement with CCTP cross-chain support',
    href: null,
  },
  {
    name: 'Jupiter DCA',
    description: 'Automated protocol fee buyback via Jupiter DCA vault',
    href: null,
  },
  {
    name: 'Discovery API',
    description: '11 REST + 4 WebSocket endpoints for agent search',
    href: '/docs/api',
  },
  {
    name: 'TypeScript SDK',
    description: 'Full typed SDK generated from on-chain IDLs. npm install @saep/sdk',
    href: 'https://www.npmjs.com/package/@saep/sdk',
  },
] as const;

export default function IntegrationsPage() {
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
          <div className="text-lime">ALL LIVE</div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((item) => {
          const inner = (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[11px] font-medium tracking-wide uppercase">
                  {item.name}
                </span>
                <span className="font-mono text-[10px] text-lime tracking-widest">LIVE</span>
              </div>
              <p className="text-[12px] text-mute leading-relaxed">{item.description}</p>
              {item.href && (
                <div className="mt-3 font-mono text-[10px] text-mute/60 truncate">
                  {item.href.replace(/^https?:\/\//, '')}
                </div>
              )}
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
