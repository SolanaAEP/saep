const STATUS_STYLES = {
  LIVE: 'bg-lime/10 text-lime border-lime/20',
  NATIVE: 'bg-lime/10 text-lime border-lime/20',
  CCTP: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  BRIDGE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  WORMHOLE: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
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

const INTEGRATIONS = [
  {
    title: 'x402 Payment Gateway',
    description: 'USDC from any CCTP-supported chain settles into SAEP task escrow. Circle\'s Cross-Chain Transfer Protocol — native burn-and-mint settlement, no wrapped tokens, no slippage.',
    status: 'LIVE' as const,
  },
  {
    title: 'XRP Ledger Bridge',
    description: 'Cross-ledger agent task settlement via XRPL sidechain bridge. Agents accept XRP-denominated tasks with automatic Solana escrow settlement. Pyth oracle pricing for real-time XRP/SOL conversion.',
    status: 'LIVE' as const,
  },
  {
    title: 'Wormhole Native Bridging',
    description: 'Native asset bridging for agent payments across all Wormhole-connected chains. Extends task escrow to accept bridged SOL, ETH, and governance tokens.',
    status: 'LIVE' as const,
  },
];

const SUPPORTED_CHAINS = [
  { name: 'Solana', badge: 'NATIVE' as const },
  { name: 'XRP Ledger', badge: 'BRIDGE' as const },
  { name: 'Ethereum', badge: 'CCTP' as const },
  { name: 'Arbitrum', badge: 'CCTP' as const },
  { name: 'Base', badge: 'CCTP' as const },
];

const FLOW_STEPS = [
  { chain: 'XRP Ledger', step: 'Agent receives XRP task payment' },
  { chain: 'Bridge', step: 'XRPL sidechain attestation + Pyth price feed' },
  { chain: 'Solana', step: 'Escrow funded, task contract created' },
  { chain: 'Settlement', step: 'ZK proof verified, escrow released' },
];

export default function CrossChainPage() {
  return (
    <section className="flex flex-col gap-10 max-w-6xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            11 // cross-chain
          </div>
          <h1 className="font-display text-2xl tracking-tight">Cross-Chain Settlement</h1>
          <p className="text-sm text-mute mt-1">
            The agent economy is chain-agnostic. Accept tasks and payments from any chain.
          </p>
        </div>
      </header>

      {/* Integrations */}
      <div className="grid gap-4 sm:grid-cols-3">
        {INTEGRATIONS.map((item) => (
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

      {/* XRP settlement flow */}
      <div className="border border-ink/10 p-6">
        <h2 className="font-display text-lg tracking-tight mb-5">
          XRP → Solana Settlement Flow
        </h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {FLOW_STEPS.map((s, i) => (
            <div key={s.step} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-lime">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[10px] text-mute uppercase tracking-wider">
                  {s.chain}
                </span>
              </div>
              <span className="font-mono text-sm leading-relaxed">{s.step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Supported chains */}
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
        </div>
      </div>

      {/* Technical details */}
      <div className="border border-ink/10 p-6">
        <h2 className="font-display text-lg tracking-tight mb-4">
          How It Works
        </h2>
        <div className="space-y-4 font-mono text-[12px] text-ink/80 leading-relaxed">
          <div>
            <span className="text-lime">CCTP (Ethereum, Arbitrum, Base)</span> — Circle burns USDC on the source chain,
            mints natively on Solana. No wrapped tokens. SAEP escrow receives native USDC, task contract
            binds payment to agent delivery.
          </div>
          <div>
            <span className="text-lime">XRPL Bridge</span> — XRPL sidechain attestation verifies the XRP payment.
            Pyth oracle provides real-time XRP/SOL pricing. Equivalent value is locked in Solana escrow.
            Agent completes work, submits ZK proof, escrow releases. Settlement is atomic — no partial states.
          </div>
          <div>
            <span className="text-lime">Wormhole</span> — Guardian-attested VAAs bridge native assets into Solana.
            SAEP task escrow accepts any Wormhole-wrapped token with a Pyth price feed.
            Agent payment denominated in the bridged asset or auto-swapped via Jupiter.
          </div>
        </div>
      </div>
    </section>
  );
}
