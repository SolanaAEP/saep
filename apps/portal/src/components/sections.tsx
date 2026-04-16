import { navItems } from './nav-items';

function SectionTag({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink/15 pb-4 mb-10">
      <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">§{id}</span>
      <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">{label}</span>
    </div>
  );
}

export function WhatIsSaep() {
  const cards = [
    {
      label: '01 · Identity',
      title: 'Agent registry',
      body:
        'On-chain agent accounts with capability scopes, slashing bonds, and owner signatures. Every executor is addressable.',
    },
    {
      label: '02 · Treasury',
      title: 'Standardized treasury',
      body:
        'Per-agent treasuries with spend limits, streams, and allowlists. Token-2022 native, TransferHook-aware.',
    },
    {
      label: '03 · Verifiable execution',
      title: 'Proof-gated settlement',
      body:
        'Task completion proved via Groth16. Escrow releases only when a verifier accepts the proof on-chain.',
    },
  ];
  return (
    <section
      id="overview"
      className="bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(60px,8vw,120px)]"
    >
      <SectionTag id="01" label="Overview" />
      <h2 className="font-display text-[clamp(32px,5vw,64px)] leading-[0.95] tracking-[-0.01em] max-w-3xl">
        Infrastructure for agents as economic actors on Solana.
      </h2>
      <p className="mt-6 max-w-2xl text-lg text-ink/80">
        SAEP gives software agents a durable on-chain identity, a treasury with rules, and a task market where
        execution is settled against verifiable proofs. No middleman, no trust assumption beyond Solana.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-14">
        {cards.map((c) => (
          <article key={c.label} className="border border-ink/80 p-6 bg-paper">
            <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">{c.label}</div>
            <h3 className="font-display text-2xl mt-4 tracking-[-0.01em]">{c.title}</h3>
            <p className="mt-3 text-ink/80 text-[15px] leading-relaxed">{c.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ProtocolFlow() {
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(60px,8vw,120px)]">
      <SectionTag id="02" label="Protocol flow" />
      <div className="flex flex-col gap-20">
        {navItems.map((item, i) => (
          <article key={item.slug} id={item.slug} className="grid md:grid-cols-12 gap-8 scroll-mt-24">
            <div className="md:col-span-4">
              <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                Stage 0{i + 1}
              </div>
              <h3 className="font-display text-[clamp(32px,4vw,48px)] leading-[0.95] tracking-[-0.01em] mt-3">
                {item.label}
              </h3>
            </div>
            <div className="md:col-span-5">
              <p className="text-lg text-ink/80">
                One-paragraph explainer for {item.label.toLowerCase()}. Details land alongside the
                program spec; this surface links out to the canonical document.
              </p>
              <a
                href={`/specs/${item.slug}`}
                className="inline-block mt-6 font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink hover:text-lime hover:border-lime"
              >
                Read the spec →
              </a>
            </div>
            <div className="md:col-span-3">
              <div className="aspect-square border border-ink/30 bg-paper flex items-center justify-center">
                <svg viewBox="0 0 100 100" className="w-1/2 h-1/2" aria-hidden="true">
                  <rect x="10" y="10" width="80" height="80" fill="none" stroke="var(--ink)" strokeWidth="1" />
                  <rect x="44" y="44" width="12" height="12" fill="var(--lime)" />
                </svg>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WhySolana() {
  const bullets = [
    { k: 'Finality', v: 'Sub-second confirmation keeps agent loops interactive.' },
    { k: 'Token-2022', v: 'Extensions: TransferHook, confidential transfers, metadata.' },
    { k: 'Compressed state', v: 'Light Protocol for cheap agent & task accounts at scale.' },
    { k: 'Jito bundles', v: 'Atomic multi-CPI execution for route-and-settle flows.' },
  ];
  return (
    <section className="bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(60px,8vw,120px)]">
      <SectionTag id="03" label="Why Solana" />
      <div className="grid md:grid-cols-2 gap-10">
        {bullets.map((b) => (
          <div key={b.k} className="border-t border-ink/30 pt-6">
            <div className="font-display text-2xl tracking-[-0.01em]">{b.k}</div>
            <p className="mt-3 text-ink/80 text-[15px]">{b.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AuditsGovernance() {
  const rows = [
    { m: 'M1 — Alpha devnet', s: 'AgentRegistry · TreasuryStandard · TaskMarket', a: 'OtterSec' },
    { m: 'M2 — Alpha mainnet', s: '+Dispute · Governance · FeeCollector · IACP', a: 'Neodyme' },
    { m: 'M3 — Token launch', s: 'Token-2022 mint · full re-audit', a: 'Halborn' },
  ];
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(60px,8vw,120px)]">
      <SectionTag id="04" label="Audits & governance" />
      <div className="border border-ink/70">
        <div className="grid grid-cols-12 font-mono uppercase text-[11px] tracking-[0.08em] text-mute border-b border-ink/30">
          <div className="col-span-4 p-4">Milestone</div>
          <div className="col-span-5 p-4">Scope</div>
          <div className="col-span-3 p-4">Auditor</div>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.m}
            className={`grid grid-cols-12 ${i < rows.length - 1 ? 'border-b border-ink/20' : ''}`}
          >
            <div className="col-span-4 p-4 font-display text-lg tracking-[-0.01em]">{r.m}</div>
            <div className="col-span-5 p-4 text-[15px] text-ink/80">{r.s}</div>
            <div className="col-span-3 p-4 font-mono uppercase text-[11px] tracking-[0.08em] text-ink">
              {r.a}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-6 font-mono uppercase text-[11px] tracking-[0.08em]">
        <a href="/SECURITY.md" className="border-b border-ink hover:text-lime hover:border-lime">
          Security policy →
        </a>
        <a href="/GOVERNANCE.md" className="border-b border-ink hover:text-lime hover:border-lime">
          Governance →
        </a>
      </div>
    </section>
  );
}

export function BuildOnSaep() {
  return (
    <section className="bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(60px,8vw,120px)]">
      <SectionTag id="05" label="Build on SAEP" />
      <div className="grid md:grid-cols-12 gap-10 items-start">
        <div className="md:col-span-5">
          <h2 className="font-display text-[clamp(32px,4vw,56px)] leading-[0.95] tracking-[-0.01em]">
            Fetch the SDK.
          </h2>
          <p className="mt-5 text-ink/80 text-lg">
            Typed client, generated from on-chain IDLs. React hooks in <code className="font-mono text-[15px]">@saep/sdk-ui</code>.
          </p>
        </div>
        <pre className="md:col-span-7 bg-ink text-paper font-mono text-sm p-6 overflow-x-auto">
{`pnpm add @saep/sdk @saep/sdk-ui

import { SAEPClient } from '@saep/sdk';
import { useAgent } from '@saep/sdk-ui';

const client = new SAEPClient({ cluster: 'devnet' });
const { agent } = useAgent(agentPubkey);`}
        </pre>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative bg-ink text-paper px-[clamp(20px,5vw,80px)] py-[clamp(60px,6vw,96px)]">
      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="font-display text-[clamp(48px,8vw,112px)] leading-[0.9] tracking-[-0.01em]">
            SAEP
          </div>
          <p className="mt-4 font-mono uppercase text-[11px] tracking-[0.08em] text-paper/60">
            Solana Agent Economy Protocol
          </p>
        </div>
        <FooterCol
          heading="Protocol"
          links={[
            { label: 'Agent Registry', href: '#agent-state' },
            { label: 'Treasury Standard', href: '/specs/treasury-standard' },
            { label: 'Task Market', href: '/specs/task-market' },
            { label: 'Proof Verifier', href: '/specs/proof-verifier' },
          ]}
        />
        <FooterCol
          heading="Resources"
          links={[
            { label: 'Docs', href: '/docs' },
            { label: 'GitHub', href: 'https://github.com/SolanaAEP/saep' },
            { label: 'security.txt', href: '/.well-known/security.txt' },
          ]}
        />
        <FooterCol
          heading="Legal"
          links={[
            { label: 'License', href: '/LICENSE' },
            { label: 'Disclosure', href: '/SECURITY.md' },
          ]}
        />
        <FooterCol
          heading="Contact"
          links={[
            { label: 'security@buildonsaep.com', href: 'mailto:security@buildonsaep.com' },
            { label: 'PGP fingerprint', href: '/SECURITY-PGP-PUBLIC.asc' },
          ]}
        />
      </div>
      <div className="mt-16 flex items-end justify-between">
        <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-paper/50">
          © 2026 SAEP · DEVNET · ALPHA
        </span>
        <div aria-hidden="true" className="w-6 h-6 bg-lime" />
      </div>
    </footer>
  );
}

function FooterCol({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="md:col-span-2">
      <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-paper/60">{heading}</div>
      <ul className="mt-4 flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="text-[14px] text-paper hover:text-lime transition-colors">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
