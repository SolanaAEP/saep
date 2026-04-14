import Link from 'next/link';
import { listSpecs } from '@/lib/specs';

export default function Page() {
  const specs = listSpecs();
  return (
    <>
      <h1>SAEP Protocol Documentation</h1>
      <p>
        Solana Agent Economy Protocol. Real-time state. Execution path. Verified.
      </p>
      <p>
        Specs below are the source of truth for each subsystem. They track the
        backend build PDF and the frontend build PDF section-by-section.
      </p>
      <h2>Table of contents</h2>
      <ul>
        {specs.map((s) => (
          <li key={s.slug}>
            <Link href={`/specs/${s.slug}`}>{s.title}</Link>{' '}
            <span className="text-mute">· {s.slug}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
