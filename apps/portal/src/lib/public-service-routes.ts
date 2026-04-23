export type PublicServiceKey = 'discovery' | 'x402' | 'iacp';

export type PublicServiceEndpoint = {
  method: 'GET' | 'POST';
  path: string;
  description: string;
};

export type PublicServiceDefinition = {
  key: PublicServiceKey;
  label: string;
  anchor: string;
  docsPath: string;
  description: string;
  publicBasePath: string;
  upstreamEnvVar: string;
  upstreamFallback: string;
  websocketUrl?: string | null;
  websocketDescription?: string;
  endpoints: PublicServiceEndpoint[];
};

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildonsaep.com').replace(/\/$/, '');
const DEFAULT_UPSTREAMS: Record<PublicServiceKey, string> = {
  discovery: 'https://saep-indexer-api.onrender.com',
  x402: 'https://saep-x402-gateway.onrender.com',
  iacp: 'https://saep-iacp.onrender.com',
};
const DIRECT_DISCOVERY = process.env.DISCOVERY_API_URL
  ?? process.env.NEXT_PUBLIC_INDEXER_URL
  ?? DEFAULT_UPSTREAMS.discovery;
const DIRECT_X402 = process.env.X402_GATEWAY_URL ?? DEFAULT_UPSTREAMS.x402;
const DIRECT_IACP = process.env.IACP_API_URL ?? DEFAULT_UPSTREAMS.iacp;
const DIRECT_IACP_WS = process.env.NEXT_PUBLIC_IACP_WS_URL ?? process.env.IACP_WS_URL ?? null;

export const PUBLIC_SERVICES: Record<PublicServiceKey, PublicServiceDefinition> = {
  discovery: {
    key: 'discovery',
    label: 'Discovery API',
    anchor: 'discovery-api',
    docsPath: '/docs/api#discovery-api',
    description: 'Stable public alias for leaderboard, bid-book reads, indexed task search, and compute-bond-enriched discovery endpoints.',
    publicBasePath: '/api/discovery',
    upstreamEnvVar: 'DISCOVERY_API_URL',
    upstreamFallback: DIRECT_DISCOVERY,
    endpoints: [
      { method: 'GET', path: '/healthz', description: 'Liveness check for the indexer API.' },
      { method: 'GET', path: '/leaderboard?capability=<bit>', description: 'Leaderboard surface used by the portal.' },
      { method: 'GET', path: '/tasks/:taskIdHex/bidding', description: 'Current bid-book phase for one task.' },
      { method: 'GET', path: '/tasks/:taskIdHex/bids', description: 'Indexed bid rows for one task.' },
      { method: 'GET', path: '/tasks?status=<csv>&limit=<n>', description: 'Indexed task feed with compute bond summaries.' },
      { method: 'GET', path: '/tasks/:taskIdHex/compute-bonds', description: 'Tracked compute bond lifecycle rows for one task.' },
      { method: 'GET', path: '/agents/:did/tasks?status=<csv>&limit=<n>', description: 'Indexed agent task history with compute bond summaries.' },
      { method: 'GET', path: '/v1/discovery/agents', description: 'Agent search, ranking, and explainable capability matching.' },
      { method: 'GET', path: '/v1/discovery/tasks', description: 'Filtered task discovery feed.' },
      { method: 'GET', path: '/v1/discovery/tasks/:taskIdHex/matches', description: 'Ranked agent matches for one task capability profile.' },
      { method: 'GET', path: '/v1/discovery/capabilities', description: 'Capability catalog.' },
      { method: 'GET', path: '/v1/discovery/treasury/yield-strategies', description: 'Governance-approved treasury yield strategy snapshots.' },
      { method: 'GET', path: '/v1/discovery/treasury/:did/yield', description: 'Per-treasury yield allocation and accounting snapshot.' },
    ],
  },
  x402: {
    key: 'x402',
    label: 'x402 Gateway',
    anchor: 'x402-gateway',
    docsPath: '/docs/api#x402-gateway',
    description: 'HTTP 402 settlement surface for paid agent endpoints backed by SAEP task escrow.',
    publicBasePath: '/api/x402',
    upstreamEnvVar: 'X402_GATEWAY_URL',
    upstreamFallback: DIRECT_X402,
    endpoints: [
      { method: 'GET', path: '/healthz', description: 'Gateway health check.' },
      { method: 'GET', path: '/metrics', description: 'Prometheus metrics for proxy and settlement activity.' },
      { method: 'GET', path: '/demo/paid', description: 'Built-in paid endpoint demo returning a 402 challenge.' },
      { method: 'POST', path: '/proxy', description: 'Settles a payment and proxies the paid upstream request.' },
      { method: 'POST', path: '/facilitate/verify', description: 'Verifies a settled `x-payment` receipt by tx signature.' },
    ],
  },
  iacp: {
    key: 'iacp',
    label: 'IACP Bus',
    anchor: 'iacp-bus',
    docsPath: '/docs/api#iacp-bus',
    description: 'HTTP control plane for the inter-agent message bus, plus an optional direct WebSocket origin.',
    publicBasePath: '/api/iacp',
    upstreamEnvVar: 'IACP_API_URL',
    upstreamFallback: DIRECT_IACP,
    websocketUrl: DIRECT_IACP_WS,
    websocketDescription: 'Dedicated direct WebSocket origin for agent subscriptions and signed publish frames.',
    endpoints: [
      { method: 'GET', path: '/healthz', description: 'Liveness plus connected-client summary.' },
      { method: 'GET', path: '/readyz', description: 'Redis-backed readiness check.' },
      { method: 'GET', path: '/metrics', description: 'Prometheus metrics for publish / websocket traffic.' },
      { method: 'POST', path: '/publish', description: 'REST publish path for signed envelopes.' },
      { method: 'GET', path: '/topics/:topic/recent?limit=<n>', description: 'Recent durable topic entries for service-token callers.' },
    ],
  },
};

export function getSiteOrigin(): string {
  return SITE_ORIGIN;
}

export function getPublicServiceDefinition(key: PublicServiceKey): PublicServiceDefinition {
  return PUBLIC_SERVICES[key];
}

export function getPublicServiceKeys(): PublicServiceKey[] {
  return Object.keys(PUBLIC_SERVICES) as PublicServiceKey[];
}

export function getPublicServicePublicUrl(key: PublicServiceKey): string {
  return `${SITE_ORIGIN}${PUBLIC_SERVICES[key].publicBasePath}`;
}

export function getPublicServiceDocsUrl(key: PublicServiceKey): string {
  return `${SITE_ORIGIN}${PUBLIC_SERVICES[key].docsPath}`;
}

export function getPublicServiceUpstreamUrl(key: PublicServiceKey): string {
  const upstreamBaseUrl = PUBLIC_SERVICES[key].upstreamFallback.replace(/\/$/, '');
  const publicBaseUrl = getPublicServicePublicUrl(key);
  if (upstreamBaseUrl === publicBaseUrl || upstreamBaseUrl.startsWith(`${publicBaseUrl}/`)) {
    return DEFAULT_UPSTREAMS[key];
  }
  return upstreamBaseUrl;
}

export function getPublicServiceManifest(key: PublicServiceKey) {
  const service = getPublicServiceDefinition(key);
  return {
    service: service.key,
    label: service.label,
    description: service.description,
    public_base_url: getPublicServicePublicUrl(key),
    upstream_base_url: getPublicServiceUpstreamUrl(key),
    docs_url: getPublicServiceDocsUrl(key),
    endpoints: service.endpoints,
    websocket_url: service.websocketUrl ?? null,
    websocket_description: service.websocketDescription ?? null,
  };
}
