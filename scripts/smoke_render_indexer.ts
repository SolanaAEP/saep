type CliOptions = {
  publicUrl: string;
  timeoutMs: number;
  pollMs: number;
  expectPrograms: string[];
  minLatestSlot: number | null;
  minEventsTotal: number | null;
  minLastSlot: number;
  help: boolean;
};

type NetworkHealth = {
  latest_slot: number;
  reorgs_24h: number;
  events_per_min: number;
  events_total: number;
  blocks_total: number;
};

const REQUIRED_METRICS = [
  'saep_indexer_db_pool_connections',
  'saep_indexer_db_pool_idle',
  'saep_indexer_db_pool_max',
] as const;

function usage(): string {
  return [
    'Usage: pnpm smoke:indexer:render [options]',
    '',
    'Smokes a hosted Render indexer API by checking public health and metrics,',
    'then optionally waiting for saep_indexer_last_slot labels to appear for',
    'specific programs.',
    '',
    'Options:',
    '  --public-url <url>         Hosted indexer API base URL',
    '  --expect-programs <csv>    Comma-separated program labels expected in saep_indexer_last_slot',
    '  --min-latest-slot <n>      Require /stats/network-health latest_slot >= n',
    '  --min-events-total <n>     Require /stats/network-health events_total >= n',
    '  --min-last-slot <n>        Minimum last-slot value for expected programs (default: 1)',
    '  --timeout-ms <n>           Poll timeout when waiting for expected programs (default: 60000)',
    '  --poll-ms <n>              Poll interval while waiting (default: 3000)',
    '  --help                     Show this help text',
    '',
    'Environment fallbacks:',
    '  SAEP_RENDER_INDEXER_PUBLIC_URL  default unset',
    '',
    'Examples:',
    '  pnpm smoke:indexer:render --public-url https://saep-indexer-api.onrender.com',
    '  pnpm smoke:indexer:render --public-url https://saep-indexer-api.onrender.com \\',
    '    --min-latest-slot 1 --min-events-total 1',
    '',
    'Note:',
    '  In the normal Render split-role setup, saep_indexer_last_slot lives on the worker,',
    '  not the web API process. Use --min-latest-slot / --min-events-total to validate',
    '  DB-backed ingest through the public API. --expect-programs is mainly useful for',
    '  single-process or worker-metrics setups.',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    publicUrl: process.env.SAEP_RENDER_INDEXER_PUBLIC_URL ?? '',
    timeoutMs: 60_000,
    pollMs: 3_000,
    expectPrograms: [],
    minLatestSlot: null,
    minEventsTotal: null,
    minLastSlot: 1,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--public-url':
        opts.publicUrl = argv[++i] ?? '';
        break;
      case '--expect-programs':
        opts.expectPrograms = (argv[++i] ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        break;
      case '--min-latest-slot':
        opts.minLatestSlot = Number(argv[++i]);
        break;
      case '--min-events-total':
        opts.minEventsTotal = Number(argv[++i]);
        break;
      case '--min-last-slot':
        opts.minLastSlot = Number(argv[++i]);
        break;
      case '--timeout-ms':
        opts.timeoutMs = Number(argv[++i]);
        break;
      case '--poll-ms':
        opts.pollMs = Number(argv[++i]);
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (opts.help) {
    return opts;
  }

  if (!/^https?:\/\//.test(opts.publicUrl)) {
    throw new Error('public-url must be an absolute http(s) URL');
  }
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error('timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(opts.pollMs) || opts.pollMs <= 0) {
    throw new Error('poll-ms must be a positive integer');
  }
  if (!Number.isInteger(opts.minLastSlot) || opts.minLastSlot < 0) {
    throw new Error('min-last-slot must be a non-negative integer');
  }
  if (opts.minLatestSlot !== null && (!Number.isInteger(opts.minLatestSlot) || opts.minLatestSlot < 0)) {
    throw new Error('min-latest-slot must be a non-negative integer');
  }
  if (opts.minEventsTotal !== null && (!Number.isInteger(opts.minEventsTotal) || opts.minEventsTotal < 0)) {
    throw new Error('min-events-total must be a non-negative integer');
  }

  return opts;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${text}`);
  }
  return text;
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

async function healthcheck(baseUrl: string): Promise<void> {
  const text = await fetchText(new URL('/healthz', baseUrl).toString());
  if (text.trim() !== 'ok') {
    throw new Error(`healthcheck returned unexpected body: ${text}`);
  }
}

function hasMetricSample(metrics: string, name: string): boolean {
  const prefix = `${name}{`;
  return metrics
    .split('\n')
    .some((line) => line.startsWith(`${name} `) || line.startsWith(prefix));
}

function parseGaugeValue(metrics: string, name: string): number | null {
  const line = metrics
    .split('\n')
    .find((candidate) => candidate.startsWith(`${name} `));
  if (!line) {
    return null;
  }
  const [, value] = line.split(/\s+/, 2);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLastSlotMetrics(metrics: string): Map<string, number> {
  const results = new Map<string, number>();
  for (const line of metrics.split('\n')) {
    if (!line.startsWith('saep_indexer_last_slot{')) {
      continue;
    }
    const match = line.match(/^saep_indexer_last_slot\{program="([^"]+)"\}\s+(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      continue;
    }
    const [, program, rawValue] = match;
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      results.set(program, value);
    }
  }
  return results;
}

async function pollFor(
  label: string,
  timeoutMs: number,
  pollMs: number,
  fn: () => Promise<boolean>,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await fn()) {
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`${label} did not converge within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function main() {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error();
    console.error(usage());
    process.exit(1);
  }

  if (opts.help) {
    console.log(usage());
    return;
  }

  console.log(`Checking hosted indexer health at ${opts.publicUrl} ...`);
  await healthcheck(opts.publicUrl);

  const metricsUrl = new URL('/metrics', opts.publicUrl).toString();
  console.log(`Fetching public metrics from ${metricsUrl} ...`);
  let metrics = await fetchText(metricsUrl);

  for (const metric of REQUIRED_METRICS) {
    if (!hasMetricSample(metrics, metric)) {
      throw new Error(
        `required metric ${metric} is missing. This usually means the deploy is still serving internal-only metrics or the process has not finished booting.`,
      );
    }
  }

  if (opts.expectPrograms.length > 0) {
    console.log(
      `Waiting for saep_indexer_last_slot to expose ${opts.expectPrograms.join(', ')} at >= ${opts.minLastSlot} ...`,
    );
    await pollFor('expected saep_indexer_last_slot labels', opts.timeoutMs, opts.pollMs, async () => {
      metrics = await fetchText(metricsUrl);
      const lastSlots = parseLastSlotMetrics(metrics);
      return opts.expectPrograms.every(
        (program) => (lastSlots.get(program) ?? -1) >= opts.minLastSlot,
      );
    });
  }

  let networkHealth: NetworkHealth | null = null;
  if (opts.minLatestSlot !== null || opts.minEventsTotal !== null) {
    const networkHealthUrl = new URL('/stats/network-health', opts.publicUrl).toString();
    console.log(`Checking DB-backed network health at ${networkHealthUrl} ...`);
    await pollFor('network-health ingest thresholds', opts.timeoutMs, opts.pollMs, async () => {
      networkHealth = await fetchJson<NetworkHealth>(networkHealthUrl);
      const latestSlotOk =
        opts.minLatestSlot === null || networkHealth.latest_slot >= opts.minLatestSlot;
      const eventsTotalOk =
        opts.minEventsTotal === null || networkHealth.events_total >= opts.minEventsTotal;
      return latestSlotOk && eventsTotalOk;
    });
  }

  const lastSlots = parseLastSlotMetrics(metrics);
  console.log('render_indexer_smoke_summary:');
  console.log(`  public_url: ${opts.publicUrl}`);
  console.log(`  db_pool_connections: ${parseGaugeValue(metrics, 'saep_indexer_db_pool_connections') ?? 'n/a'}`);
  console.log(`  db_pool_idle: ${parseGaugeValue(metrics, 'saep_indexer_db_pool_idle') ?? 'n/a'}`);
  console.log(`  db_pool_max: ${parseGaugeValue(metrics, 'saep_indexer_db_pool_max') ?? 'n/a'}`);
  if (networkHealth) {
    console.log('  network_health:');
    console.log(`    latest_slot: ${networkHealth.latest_slot}`);
    console.log(`    reorgs_24h: ${networkHealth.reorgs_24h}`);
    console.log(`    events_per_min: ${networkHealth.events_per_min}`);
    console.log(`    events_total: ${networkHealth.events_total}`);
    console.log(`    blocks_total: ${networkHealth.blocks_total}`);
  }
  if (lastSlots.size === 0) {
    console.log('  last_slot_programs: none yet');
  } else {
    console.log('  last_slot_programs:');
    for (const [program, value] of [...lastSlots.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      console.log(`    ${program}: ${value}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
