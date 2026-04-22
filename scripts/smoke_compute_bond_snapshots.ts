import { randomBytes } from 'node:crypto';

type Provider = 'ionet' | 'akash';

type CliOptions = {
  brokerUrl: string;
  discoveryUrl: string;
  indexerUrl: string;
  agentDid: string;
  provider: Provider;
  gpuHours: number;
  durationSecs: number;
  timeoutMs: number;
  pollMs: number;
  taskId: string;
  skipRelease: boolean;
  help: boolean;
};

type BrokerRequestResponse = {
  lease_id: string;
  attestation_sig: string;
  broker_pubkey: string;
  gpu_hours: number;
  expires_at: number;
  slashable_until: number;
  bond_status: string;
  reserved_price_usd_micro: number | null;
};

type ComputeBondSummary = {
  lease_id: string;
  agent_did: string;
  provider: Provider;
  gpu_hours: number;
  expires_at: number;
  slashable_until: number;
  task_id: string | null;
  status: string;
  status_reason: string | null;
  reserved_price_usd_micro: number | null;
  broker_pubkey: string;
  attestation_sig: string;
  created_at_ms: number;
  updated_at_ms: number;
  provider_status: string | null;
};

type TaskComputeBondPage = {
  task_id: string;
  items: ComputeBondSummary[];
};

const DEFAULT_AGENT_DID = '11111111111111111111111111111111';

function usage(): string {
  return [
    'Usage: pnpm smoke:compute-bonds [options]',
    '',
    'Drives a live broker -> persisted snapshot -> discovery/indexer read-path smoke check.',
    'All services must already be running.',
    '',
    'Options:',
    '  --broker-url <url>      Compute broker base URL',
    '  --discovery-url <url>   Discovery base URL',
    '  --indexer-url <url>     Public indexer API base URL',
    '  --agent-did <did>       Agent DID/base58 string sent to the broker',
    '  --provider <name>       ionet | akash (default: ionet)',
    '  --gpu-hours <n>         Requested GPU hours (default: 4)',
    '  --duration-secs <n>     Lease duration in seconds (default: 3600)',
    '  --task-id <hex>         32-byte hex task id to lock against',
    '  --timeout-ms <n>        Poll timeout per phase (default: 20000)',
    '  --poll-ms <n>           Poll interval (default: 1000)',
    '  --skip-release          Stop after the locked snapshot check',
    '  --help                  Show this help text',
    '',
    'Environment fallbacks:',
    '  SAEP_COMPUTE_BROKER_URL  default http://127.0.0.1:8788',
    '  SAEP_DISCOVERY_URL       default http://127.0.0.1:8790',
    '  SAEP_INDEXER_PUBLIC_URL  default http://127.0.0.1:8081',
    '',
    'Expected local indexer config:',
    '  INDEXER_ROLE=all API_PORT=8081 HEALTHCHECK_PORT=8080 INDEXER_INTERNAL_API_TOKEN=<token>',
    '',
    'Expected local broker config:',
    '  INDEXER_INTERNAL_API_URL=http://127.0.0.1:8080 INDEXER_INTERNAL_API_TOKEN=<same token>',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    brokerUrl: process.env.SAEP_COMPUTE_BROKER_URL ?? 'http://127.0.0.1:8788',
    discoveryUrl: process.env.SAEP_DISCOVERY_URL ?? 'http://127.0.0.1:8790',
    indexerUrl: process.env.SAEP_INDEXER_PUBLIC_URL ?? 'http://127.0.0.1:8081',
    agentDid: DEFAULT_AGENT_DID,
    provider: 'ionet',
    gpuHours: 4,
    durationSecs: 3600,
    timeoutMs: 20_000,
    pollMs: 1_000,
    taskId: randomBytes(32).toString('hex'),
    skipRelease: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--broker-url':
        opts.brokerUrl = argv[++i] ?? '';
        break;
      case '--discovery-url':
        opts.discoveryUrl = argv[++i] ?? '';
        break;
      case '--indexer-url':
        opts.indexerUrl = argv[++i] ?? '';
        break;
      case '--agent-did':
        opts.agentDid = argv[++i] ?? '';
        break;
      case '--provider': {
        const provider = argv[++i];
        if (provider !== 'ionet' && provider !== 'akash') {
          throw new Error(`invalid provider: ${provider}`);
        }
        opts.provider = provider;
        break;
      }
      case '--gpu-hours':
        opts.gpuHours = Number(argv[++i]);
        break;
      case '--duration-secs':
        opts.durationSecs = Number(argv[++i]);
        break;
      case '--task-id':
        opts.taskId = (argv[++i] ?? '').toLowerCase();
        break;
      case '--timeout-ms':
        opts.timeoutMs = Number(argv[++i]);
        break;
      case '--poll-ms':
        opts.pollMs = Number(argv[++i]);
        break;
      case '--skip-release':
        opts.skipRelease = true;
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

  if (!/^https?:\/\//.test(opts.brokerUrl)) {
    throw new Error('broker-url must be an absolute http(s) URL');
  }
  if (!/^https?:\/\//.test(opts.discoveryUrl)) {
    throw new Error('discovery-url must be an absolute http(s) URL');
  }
  if (!/^https?:\/\//.test(opts.indexerUrl)) {
    throw new Error('indexer-url must be an absolute http(s) URL');
  }
  if (!/^[0-9a-f]{64}$/.test(opts.taskId)) {
    throw new Error('task-id must be a 32-byte hex string');
  }
  if (!Number.isInteger(opts.gpuHours) || opts.gpuHours <= 0) {
    throw new Error('gpu-hours must be a positive integer');
  }
  if (!Number.isInteger(opts.durationSecs) || opts.durationSecs <= 0) {
    throw new Error('duration-secs must be a positive integer');
  }
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error('timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(opts.pollMs) || opts.pollMs <= 0) {
    throw new Error('poll-ms must be a positive integer');
  }
  return opts;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status} ${text}`);
  }
  return json as T;
}

async function healthcheck(baseUrl: string, label: string): Promise<void> {
  const url = new URL('/healthz', baseUrl);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${label} healthcheck failed: ${res.status}`);
  }
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

function matchesBond(
  page: TaskComputeBondPage,
  leaseId: string,
  expectedStatus: string,
  expectedProviderStatus: string,
): boolean {
  return page.items.some(
    (item) =>
      item.lease_id === leaseId &&
      item.status === expectedStatus &&
      item.provider_status === expectedProviderStatus,
  );
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

  const discoveryTaskUrl = new URL(`/tasks/${opts.taskId}/compute-bonds`, opts.discoveryUrl);
  const indexerTaskUrl = new URL(
    `/v1/discovery/tasks/${opts.taskId}/compute-bonds`,
    opts.indexerUrl,
  );

  console.log('Checking service health...');
  await Promise.all([
    healthcheck(opts.brokerUrl, 'compute-broker'),
    healthcheck(opts.discoveryUrl, 'discovery'),
    healthcheck(opts.indexerUrl, 'indexer public api'),
  ]);

  console.log(`Requesting compute bond from ${opts.provider}...`);
  const requested = await fetchJson<BrokerRequestResponse>(new URL('/bonds/request', opts.brokerUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_did: opts.agentDid,
      provider: opts.provider,
      gpu_hours: opts.gpuHours,
      duration_secs: opts.durationSecs,
    }),
  });

  console.log(`Reserved lease ${requested.lease_id}; locking to task ${opts.taskId}...`);
  await fetchJson(
    new URL('/bonds/lock', opts.brokerUrl).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lease_id: requested.lease_id,
        provider: opts.provider,
        agent_did: opts.agentDid,
        task_id: opts.taskId,
      }),
    },
  );

  console.log('Waiting for the locked snapshot to appear through discovery...');
  await pollFor('discovery locked snapshot', opts.timeoutMs, opts.pollMs, async () => {
    const page = await fetchJson<TaskComputeBondPage>(discoveryTaskUrl.toString());
    return matchesBond(page, requested.lease_id, 'locked', 'active');
  });

  console.log('Waiting for the locked snapshot to appear through the indexer...');
  await pollFor('indexer locked snapshot', opts.timeoutMs, opts.pollMs, async () => {
    const page = await fetchJson<TaskComputeBondPage>(indexerTaskUrl.toString());
    return matchesBond(page, requested.lease_id, 'locked', 'active');
  });

  if (!opts.skipRelease) {
    console.log(`Releasing lease ${requested.lease_id}...`);
    await fetchJson(
      new URL('/bonds/release', opts.brokerUrl).toString(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lease_id: requested.lease_id,
          provider: opts.provider,
          agent_did: opts.agentDid,
          task_id: opts.taskId,
        }),
      },
    );

    console.log('Waiting for the released snapshot to appear through discovery...');
    await pollFor('discovery released snapshot', opts.timeoutMs, opts.pollMs, async () => {
      const page = await fetchJson<TaskComputeBondPage>(discoveryTaskUrl.toString());
      return matchesBond(page, requested.lease_id, 'released', 'reclaimed');
    });

    console.log('Waiting for the released snapshot to appear through the indexer...');
    await pollFor('indexer released snapshot', opts.timeoutMs, opts.pollMs, async () => {
      const page = await fetchJson<TaskComputeBondPage>(indexerTaskUrl.toString());
      return matchesBond(page, requested.lease_id, 'released', 'reclaimed');
    });
  }

  console.log();
  console.log('Smoke passed.');
  console.log(`  lease_id: ${requested.lease_id}`);
  console.log(`  task_id:  ${opts.taskId}`);
  console.log(`  broker:   ${opts.brokerUrl}`);
  console.log(`  discover: ${opts.discoveryUrl}`);
  console.log(`  indexer:  ${opts.indexerUrl}`);
  if (opts.skipRelease) {
    console.log('  release:  skipped');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(
    'Hint: make sure the indexer is running with INDEXER_ROLE=all and the broker has INDEXER_INTERNAL_API_URL + INDEXER_INTERNAL_API_TOKEN configured.',
  );
  process.exit(1);
});
