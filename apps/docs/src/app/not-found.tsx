import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col gap-4 py-20">
      <div className="font-mono text-[10px] text-mute tracking-widest uppercase">404</div>
      <h1 className="font-display text-2xl">Page not found</h1>
      <p className="text-sm text-mute">This spec doesn&apos;t exist or has been moved.</p>
      <Link href="/" className="font-mono text-[11px] text-lime hover:underline">
        ← Back to all specs
      </Link>
    </div>
  );
}
