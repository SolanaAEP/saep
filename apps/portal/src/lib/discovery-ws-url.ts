// Browser-side helper for the discovery WebSocket origin.
//
// REST reads go through the /api/discovery proxy (see indexer-url.ts) so they
// don't depend on cross-origin headers from the upstream service. WebSocket
// upgrades cannot use the same proxy because Next.js App Router route handlers
// strip the `upgrade` hop-by-hop header (see service-proxy.ts:18) — a connect
// attempt against /api/discovery/ws will never complete the handshake.
//
// Operators expose the discovery service's /ws endpoint at a known origin and
// set NEXT_PUBLIC_DISCOVERY_WS_URL so the client can dial it directly. When the
// env is absent we return null and consuming hooks gracefully fall back to
// polling-only behaviour.

export function getPortalDiscoveryWsUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_DISCOVERY_WS_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}
