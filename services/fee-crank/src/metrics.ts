import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const currentEpochId = new Gauge({
  name: 'saep_crank_current_epoch_id',
  help: 'Current epoch ID from FeeCollectorConfig',
  registers: [registry],
});

export const epochStatus = new Gauge({
  name: 'saep_crank_epoch_status',
  help: 'Current epoch status (0=Open, 1=Splitting, 2=DistributionCommitted, 3=Stale)',
  registers: [registry],
});

export const harvestTotal = new Counter({
  name: 'saep_crank_harvest_total',
  help: 'Harvest attempts',
  labelNames: ['type', 'outcome'] as const,
  registers: [registry],
});

export const processEpochTotal = new Counter({
  name: 'saep_crank_process_epoch_total',
  help: 'Process epoch attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const executeBurnTotal = new Counter({
  name: 'saep_crank_execute_burn_total',
  help: 'Execute burn attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const sweepStaleTotal = new Counter({
  name: 'saep_crank_sweep_stale_total',
  help: 'Sweep stale epoch attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const tickDuration = new Histogram({
  name: 'saep_crank_tick_duration_seconds',
  help: 'Fee crank tick duration',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const tickFailuresTotal = new Counter({
  name: 'saep_crank_tick_failures_total',
  help: 'Tick errors',
  labelNames: ['stage'] as const,
  registers: [registry],
});

export const tickSkippedTotal = new Counter({
  name: 'saep_crank_tick_skipped_total',
  help: 'Ticks skipped',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const snapshotTotal = new Counter({
  name: 'saep_crank_snapshot_total',
  help: 'Epoch snapshot attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});
