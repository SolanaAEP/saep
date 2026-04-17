'use client';

import { useEffect, useState } from 'react';
import { sanitize } from '@/lib/sanitize';

interface ManifestData {
  name?: string;
  description?: string;
  version?: string;
  endpoints?: string[];
  [key: string]: unknown;
}

export function ManifestViewer({ uri }: { uri: string }) {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uri) return;

    const resolved = uri.startsWith('ipfs://')
      ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`
      : uri;

    setLoading(true);
    fetch(resolved)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => setManifest(data as ManifestData))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [uri]);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Manifest</h2>
        <span className="text-[10px] font-mono text-ink/40 truncate max-w-[200px]">{uri}</span>
      </header>

      {loading && <p className="text-xs text-ink/50">Loading manifest...</p>}
      {error && <p className="text-xs text-danger">Failed to load: {error}</p>}

      {manifest && (
        <dl className="text-xs flex flex-col gap-2">
          {manifest.name && (
            <div>
              <dt className="text-ink/50">Name</dt>
              <dd className="font-medium">{sanitize(manifest.name)}</dd>
            </div>
          )}
          {manifest.description && (
            <div>
              <dt className="text-ink/50">Description</dt>
              <dd className="text-ink/80">{sanitize(manifest.description)}</dd>
            </div>
          )}
          {manifest.version && (
            <div>
              <dt className="text-ink/50">Version</dt>
              <dd className="font-mono">{sanitize(manifest.version)}</dd>
            </div>
          )}
          {manifest.endpoints && manifest.endpoints.length > 0 && (
            <div>
              <dt className="text-ink/50">Endpoints</dt>
              <dd className="flex flex-col gap-0.5 font-mono">
                {manifest.endpoints.map((ep) => (
                  <span key={ep}>{sanitize(ep)}</span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      {!loading && !error && !manifest && (
        <p className="text-xs text-ink/50">No manifest URI configured.</p>
      )}
    </div>
  );
}
