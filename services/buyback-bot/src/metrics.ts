import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const feeAccumulatorBalance = new Gauge({
  name: 'saep_buyback_fee_accumulator_usdc_base',
  help: 'Current USDC balance (base units, 6 decimals) of the fee_collector token account on MarketGlobal',
  registers: [registry],
});

export const lastQuoteSaepOutput = new Gauge({
  name: 'saep_buyback_quote_saep_out_base',
  help: 'Last Jupiter quote out-amount in SAEP base units (6 decimals)',
  registers: [registry],
});

export const lastQuotePriceImpactBps = new Gauge({
  name: 'saep_buyback_quote_price_impact_bps',
  help: 'Last Jupiter quote price impact in basis points',
  registers: [registry],
});

export const swapAttemptsTotal = new Counter({
  name: 'saep_buyback_swap_attempts_total',
  help: 'Buyback swap attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const burnAttemptsTotal = new Counter({
  name: 'saep_buyback_burn_attempts_total',
  help: 'Buyback burn attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const tickDuration = new Histogram({
  name: 'saep_buyback_tick_duration_seconds',
  help: 'Buyback worker tick duration',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const tickSkippedTotal = new Counter({
  name: 'saep_buyback_tick_skipped_total',
  help: 'Buyback worker ticks that did not result in a swap',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const tickFailuresTotal = new Counter({
  name: 'saep_buyback_tick_failures_total',
  help: 'Buyback worker ticks that errored before completing',
  labelNames: ['stage'] as const,
  registers: [registry],
});
