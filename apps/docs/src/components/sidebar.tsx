import Link from 'next/link';
import { listSpecs } from '@/lib/specs';

export function Sidebar() {
  const specs = listSpecs();
  const protocol = specs.filter((s) => s.group === 'protocol');
  const ops = specs.filter((s) => s.group === 'ops');
  return (
    <aside className="font-mono text-[12px]">
      <Section title="Protocol" items={protocol} />
      <Section title="Ops" items={ops} />
    </aside>
  );
}

function Section({
  title,
  items,
}: {
  title: string;
  items: { slug: string; title: string }[];
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-mute">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.slug}>
            <Link
              href={`/specs/${i.slug}`}
              className="block hover:text-mute"
            >
              {i.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
