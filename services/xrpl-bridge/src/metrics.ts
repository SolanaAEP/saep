import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const bridgeRequests = new Counter({
  name: 'xrpl_bridge_requests_total',
  help: 'bridge settlement attempts',
  labelNames: ['status'],
  registers: [registry],
});

export const bridgeDuration = new Histogram({
  name: 'xrpl_bridge_duration_seconds',
  help: 'end-to-end bridge settlement latency',
  labelNames: ['status'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const xrplListenerConnected = new Gauge({
  name: 'xrpl_listener_connected',
  help: '1 if websocket connected to XRPL, 0 otherwise',
  registers: [registry],
});

export const xrplPaymentsReceived = new Counter({
  name: 'xrpl_payments_received_total',
  help: 'XRPL payments detected by listener',
  registers: [registry],
});

export const priceOracleAge = new Gauge({
  name: 'xrpl_price_oracle_age_seconds',
  help: 'age of cached price data',
  labelNames: ['pair'],
  registers: [registry],
});

export const wormholeVaas = new Counter({
  name: 'xrpl_wormhole_vaas_total',
  help: 'wormhole VAAs processed',
  labelNames: ['status'],
  registers: [registry],
});
