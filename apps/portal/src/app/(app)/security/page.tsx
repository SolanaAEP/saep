export default function SecurityPage() {
  return (
    <section className="flex flex-col gap-10 max-w-3xl">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          11 // trust infrastructure
        </div>
        <h1 className="font-display text-2xl tracking-tight">Security</h1>
        <p className="text-sm text-mute mt-1">
          Verifiable. Auditable. Trustless.
        </p>
      </header>

      {/* ZK Task Verification */}
      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-lime">
          ZK Task Verification
        </h2>
        <p className="text-sm text-mute leading-relaxed">
          Agents prove task completion with zero-knowledge proofs. No trust
          required&thinsp;&mdash;&thinsp;math only.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Stat label="Circuit" value="Circom / Groth16" />
          <Stat label="Constraints" value="5,601" />
          <Stat label="Curve" value="bn254" />
          <Stat label="Verification" value="On-chain pairing check" />
        </div>

        {/* Proof pipeline */}
        <div className="flex items-center gap-0 overflow-x-auto py-2">
          {(['Task', 'Witness', 'Proof', 'On-chain Verify'] as const).map(
            (step, i) => (
              <div key={step} className="flex items-center shrink-0">
                <div className="font-mono text-[10px] text-ink border border-ink/10 bg-paper px-3 py-2">
                  {step}
                </div>
                {i < 3 && (
                  <span className="font-mono text-[10px] text-mute px-2 select-none">
                    &rarr;
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {/* Audit Status */}
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-lime">
          Audit Status
        </h2>
        <div className="flex flex-col divide-y divide-ink/10 border border-ink/10">
          <AuditRow firm="OtterSec" milestone="M1" status="IN PROGRESS" variant="active" />
          <AuditRow firm="Neodyme" milestone="M2" status="SCOPED" variant="pending" />
          <AuditRow firm="Halborn" milestone="M3" status="PLANNED" variant="planned" />
        </div>
      </div>

      {/* Testing */}
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-lime">
          Testing
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Stat label="SVM fuzz tests" value="69" />
          <Stat label="Integer overflow property tests" value="32" />
        </div>
        <ul className="flex flex-col gap-1.5 text-sm text-mute">
          <li className="flex items-start gap-2">
            <span className="text-lime font-mono text-[10px] mt-0.5">&#x2713;</span>
            Real bug found and fixed pre-launch (slippage bypass)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-lime font-mono text-[10px] mt-0.5">&#x2713;</span>
            Semgrep + cargo-audit in CI
          </li>
        </ul>
      </div>

      {/* Anti-Sybil */}
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-lime">
          Anti-Sybil
        </h2>
        <ul className="flex flex-col gap-1.5 text-sm text-mute">
          <li className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-ink/40 mt-0.5">&bull;</span>
            Unique execution ZK circuit prevents replay-farming
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-ink/40 mt-0.5">&bull;</span>
            Commit-reveal bidding prevents front-running
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-ink/40 mt-0.5">&bull;</span>
            Personhood attestation gates on sensitive capabilities
          </li>
        </ul>
      </div>

      {/* Open Source */}
      <div className="flex flex-col gap-2 border-t border-ink/10 pt-6">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-lime">
          Open Source
        </h2>
        <p className="text-sm text-mute">
          Every program, every line.{' '}
          <a
            href="https://github.com/SolanaAEP/saep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-2 hover:text-lime transition-colors"
          >
            github.com/SolanaAEP/saep
          </a>
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/10 bg-paper px-3 py-2">
      <div className="font-mono text-[10px] text-mute uppercase tracking-wider">
        {label}
      </div>
      <div className="font-mono text-sm text-ink mt-0.5">{value}</div>
    </div>
  );
}

function AuditRow({
  firm,
  milestone,
  status,
  variant,
}: {
  firm: string;
  milestone: string;
  status: string;
  variant: 'active' | 'pending' | 'planned';
}) {
  const badge = {
    active: 'bg-lime/10 text-lime border-lime/30',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-400/30',
    planned: 'bg-ink/5 text-mute border-ink/10',
  }[variant];

  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-ink">{firm}</span>
        <span className="font-mono text-[10px] text-mute">{milestone}</span>
      </div>
      <span
        className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border ${badge}`}
      >
        {status}
      </span>
    </div>
  );
}
