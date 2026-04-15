import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const proxyRequests = new Counter({
  name: 'x402_proxy_requests_total',
  help: 'outbound proxy attempts',
  labelNames: ['status'],
  registers: [registry],
});

export const proxyDuration = new Histogram({
  name: 'x402_proxy_duration_seconds',
  help: 'end-to-end proxy latency including upstream call',
  labelNames: ['status'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const facilitateVerifyTotal = new Counter({
  name: 'x402_facilitate_verify_total',
  help: 'inbound facilitator verify calls',
  labelNames: ['result'],
  registers: [registry],
});

export const cctpFallbackTotal = new Counter({
  name: 'x402_cctp_fallback_total',
  help: 'cctp cross-chain fallback attempts',
  labelNames: ['result'],
  registers: [registry],
});
