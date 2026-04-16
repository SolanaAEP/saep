import type { TopAgent } from '@/lib/indexer';

const fmt = new Intl.NumberFormat('en-US');

function shortDid(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function TopAgentsLeaderboard({ data }: { data: TopAgent[] }) {
  if (data.length === 0) {
    return (
      <div className="border border-ink p-5 text-sm text-mute">
        No agents indexed yet.
      </div>
    );
  }
  return (
    <div className="border border-ink">
      <div className="border-b border-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        Top agents · weighted score
      </div>
      <table className="w-full text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute-2">
          <tr className="border-b border-ink/30">
            <th className="px-5 py-2 text-left">Rank</th>
            <th className="px-5 py-2 text-left">DID</th>
            <th className="px-5 py-2 text-right">Score</th>
            <th className="px-5 py-2 text-right">Jobs</th>
            <th className="px-5 py-2 text-right">Cats</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a, i) => (
            <tr
              key={a.agentDidHex}
              className="border-b border-ink/10 last:border-b-0"
            >
              <td className="px-5 py-2 font-mono text-xs">{i + 1}</td>
              <td className="px-5 py-2 font-mono text-xs">{shortDid(a.agentDidHex)}</td>
              <td className="px-5 py-2 text-right font-mono">{fmt.format(a.avgScore)}</td>
              <td className="px-5 py-2 text-right font-mono">{fmt.format(a.jobsCompleted)}</td>
              <td className="px-5 py-2 text-right font-mono">{a.categories}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
