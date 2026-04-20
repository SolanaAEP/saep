const STATUS_STYLES = {
  LIVE: 'bg-lime/10 text-lime border-lime/20',
  'IN DEVELOPMENT': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  RESEARCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  PLANNED: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  NATIVE: 'bg-lime/10 text-lime border-lime/20',
  CCTP: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
} as const;

function Badge({ label }: { label: keyof typeof STATUS_STYLES }) {
  return (
    <span
      className={`inline-block font-mono text-[10px] tracking-wider px-2 py-0.5 border rounded ${STATUS_STYLES[label]}`}
    >
      {label}
    </span>
  );
}

const ROADMAP = [
  {
    title: 'Wormhole Bridge',
    description: 'Native asset bridging for agent payments',
    status: 'IN DEVELOPMENT' as const,
  },
  {
    title: 'XRP Ledger',
    description: 'Cross-ledger agent task settlement',
    status: 'RESEARCH' as const,
  },
  {
    title: 'EVM Chains',
    description: 'Ethereum, Base, Arbitrum agent interop',
    status: 'PLANNED' as const,
  },
];

const FLOW_STEPS = [
  'Payment on origin chain',
  'CCTP attestation',
  'SAEP escrow on Solana',
];

const SUPPORTED_CHAINS = [
  { name: 'Solana', badge: 'NATIVE' as const },
  { name: 'Ethereum', badge: 'CCTP' as const },
  { name: 'Arbitrum', badge: 'CCTP' as const },
  { name: 'Base', badge: 'CCTP' as const },
];

export default function CrossChainPage() {
  return (
    <section className="flex flex-col gap-10 max-w-6xl">
      {/* header */}
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            13 // cross-chain
          </div>
          <h1 className="font-display text-2xl tracking-tight">Cross-Chain</h1>
          <p className="text-sm text-mute mt-1">
            The agent economy is chain-agnostic.
          </p>
        </div>
      </header>

      {/* live now */}
      <div className="border border-ink/10 p-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-display text-lg tracking-tight">Live Now</h2>
          <Badge label="LIVE" />
        </div>
        <h3 className="font-mono text-sm mb-1">
          x402 Payment Gateway with CCTP
        </h3>
        <p className="text-sm text-mute leading-relaxed max-w-2xl">
          USDC from any CCTP-supported chain settles into SAEP task escrow.
          Circle&rsquo;s Cross-Chain Transfer Protocol provides native burn-and-mint
          settlement — no wrapped tokens, no bridges, no slippage.
        </p>
      </div>

      {/* coming soon */}
      <div>
        <h2 className="font-display text-lg tracking-tight mb-4">
          Coming Soon
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {ROADMAP.map((item) => (
            <div
              key={item.title}
              className="border border-ink/10 p-5 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm">{item.title}</h3>
                <Badge label={item.status} />
              </div>
              <p className="text-sm text-mute leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* settlement flow */}
      <div className="border border-ink/10 p-6">
        <h2 className="font-display text-lg tracking-tight mb-5">
          How Cross-Chain Settlement Works
        </h2>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {FLOW_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-mute">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-sm">{step}</span>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <span className="hidden sm:block font-mono text-mute text-xs">
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* supported chains */}
      <div>
        <h2 className="font-display text-lg tracking-tight mb-4">
          Supported Chains
        </h2>
        <div className="border border-ink/10 divide-y divide-ink/10">
          {SUPPORTED_CHAINS.map((chain) => (
            <div
              key={chain.name}
              className="flex items-center justify-between px-5 py-3"
            >
              <span className="font-mono text-sm">{chain.name}</span>
              <Badge label={chain.badge} />
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3">
            <span className="font-mono text-sm text-mute">More coming…</span>
          </div>
        </div>
      </div>
    </section>
  );
}
