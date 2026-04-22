import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type CliOptions = {
  keepLogs: boolean;
  help: boolean;
  smokeArgs: string[];
};

type ManagedProcess = {
  name: string;
  child: ChildProcess;
  logPath: string;
};

const DEFAULTS = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://saep:saep@localhost:5432/saep',
  indexerInternalPort: Number(process.env.SMOKE_INDEXER_INTERNAL_PORT ?? '8080'),
  indexerApiPort: Number(process.env.SMOKE_INDEXER_API_PORT ?? '8081'),
  discoveryPort: Number(process.env.SMOKE_DISCOVERY_PORT ?? '8790'),
  brokerPort: Number(process.env.SMOKE_COMPUTE_BROKER_PORT ?? '8788'),
  timeoutMs: Number(process.env.SMOKE_COMPUTE_BOND_TIMEOUT_MS ?? '90000'),
  pollMs: Number(process.env.SMOKE_COMPUTE_BOND_POLL_MS ?? '1000'),
  token: process.env.INDEXER_INTERNAL_API_TOKEN ?? 'local-saep-indexer-token',
  signingKeyHex:
    process.env.BROKER_SIGNING_KEY_HEX ??
    'abababababababababababababababababababababababababababababababab',
};

function usage(): string {
  return [
    'Usage: pnpm smoke:compute-bonds:local [options] [-- <smoke args>]',
    '',
    'Boots Postgres + indexer(api) + discovery + compute-broker(mock),',
    'runs the existing compute-bond smoke flow, then tears everything down.',
    '',
    'Options:',
    '  --keep-logs   Keep test-results/compute-bond-smoke/<timestamp> on success',
    '  --help        Show this help text',
    '',
    'Any arguments after `--` are forwarded to pnpm smoke:compute-bonds.',
    '',
    'Environment overrides:',
    '  DATABASE_URL',
    '  SMOKE_INDEXER_INTERNAL_PORT',
    '  SMOKE_INDEXER_API_PORT',
    '  SMOKE_DISCOVERY_PORT',
    '  SMOKE_COMPUTE_BROKER_PORT',
    '  SMOKE_COMPUTE_BOND_TIMEOUT_MS',
    '  SMOKE_COMPUTE_BOND_POLL_MS',
    '  INDEXER_INTERNAL_API_TOKEN',
    '  BROKER_SIGNING_KEY_HEX',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    keepLogs: false,
    help: false,
    smokeArgs: [],
  };

  let forwarding = false;
  for (const arg of argv) {
    if (forwarding) {
      options.smokeArgs.push(arg);
      continue;
    }
    if (arg === '--') {
      forwarding = true;
      continue;
    }
    if (arg === '--keep-logs') {
      options.keepLogs = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function ensureDockerAvailable(): void {
  const docker = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  if (docker.error) {
    throw new Error(
      'docker CLI is required for pnpm smoke:compute-bonds:local. Install Docker Desktop or another docker-compatible runtime.',
    );
  }
  const compose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  if (compose.error || compose.status !== 0) {
    throw new Error(
      'docker compose is required for pnpm smoke:compute-bonds:local. Make sure Docker is installed and the compose plugin is available.',
    );
  }
}

async function runCommand(
  label: string,
  cmd: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
  },
): Promise<void> {
  const logStream = createWriteStream(options.logPath, { flags: 'a' });
  logStream.write(`$ ${cmd} ${args.join(' ')}\n`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    child.on('error', (error) => {
      logStream.end();
      rejectPromise(error);
    });

    child.on('exit', (code, signal) => {
      logStream.end();
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`${label} failed (${signal ? `signal ${signal}` : `exit ${code}`}); see ${options.logPath}`),
      );
    });
  });
}

function startProcess(
  name: string,
  cmd: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
  },
): ManagedProcess {
  const logStream = createWriteStream(options.logPath, { flags: 'a' });
  logStream.write(`$ ${cmd} ${args.join(' ')}\n`);

  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.on('exit', () => {
    logStream.end();
  });
  child.on('error', () => {
    logStream.end();
  });

  return { name, child, logPath: options.logPath };
}

function processExited(proc: ManagedProcess): boolean {
  return proc.child.exitCode !== null || proc.child.signalCode !== null;
}

async function stopProcess(proc: ManagedProcess): Promise<void> {
  if (processExited(proc)) {
    return;
  }

  proc.child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolvePromise) => {
      proc.child.once('exit', () => resolvePromise(true));
    }),
    delay(5_000).then(() => false),
  ]);

  if (!exited && !processExited(proc)) {
    proc.child.kill('SIGKILL');
    await new Promise<void>((resolvePromise) => {
      proc.child.once('exit', () => resolvePromise());
    });
  }
}

async function waitForHealth(
  label: string,
  url: string,
  timeoutMs: number,
  pollMs: number,
  proc?: ManagedProcess,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (proc && processExited(proc)) {
      throw new Error(`${label} exited early; see ${proc.logPath}`);
    }

    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // keep polling until the timeout expires
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`${label} did not become healthy within ${timeoutMs}ms`);
    }

    await delay(pollMs);
  }
}

async function waitForPostgres(repoRoot: string, logPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      await runCommand(
        'postgres readiness check',
        'docker',
        ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'saep', '-d', 'saep'],
        { cwd: repoRoot, logPath },
      );
      return;
    } catch {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`postgres did not become ready within ${timeoutMs}ms; see ${logPath}`);
      }
      await delay(1_000);
    }
  }
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error();
    console.error(usage());
    process.exit(1);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  ensureDockerAvailable();

  const repoRoot = process.cwd();
  const baseLogDir = resolve(repoRoot, 'test-results/compute-bond-smoke');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runLogDir = join(baseLogDir, runId);
  await mkdir(runLogDir, { recursive: true });

  const cleanup: Array<() => Promise<void>> = [];
  let succeeded = false;

  try {
    console.log('Starting Postgres...');
    await runCommand('docker compose up postgres', 'docker', ['compose', 'up', '-d', 'postgres'], {
      cwd: repoRoot,
      logPath: join(runLogDir, 'docker-compose.log'),
    });
    cleanup.push(async () => {
      await runCommand('docker compose stop postgres', 'docker', ['compose', 'stop', 'postgres'], {
        cwd: repoRoot,
        logPath: join(runLogDir, 'docker-compose.log'),
      }).catch(() => undefined);
    });

    await waitForPostgres(repoRoot, join(runLogDir, 'postgres-ready.log'), DEFAULTS.timeoutMs);

    console.log('Building discovery, compute-broker, and indexer...');
    await runCommand('build discovery', 'pnpm', ['--filter', '@saep/discovery', 'build'], {
      cwd: repoRoot,
      logPath: join(runLogDir, 'build-discovery.log'),
    });
    await runCommand('build compute-broker', 'pnpm', ['--filter', '@saep/compute-broker', 'build'], {
      cwd: repoRoot,
      logPath: join(runLogDir, 'build-compute-broker.log'),
    });
    await runCommand(
      'build indexer',
      'docker',
      ['build', '-f', 'services/indexer/Dockerfile', '-t', 'saep-indexer-smoke:local', '.'],
      {
        cwd: repoRoot,
        logPath: join(runLogDir, 'build-indexer.log'),
      },
    );

    console.log('Starting indexer...');
    const containerName = `saep-indexer-smoke-${runId.toLowerCase()}`.replace(/[^a-z0-9-]/g, '-');
    const indexer = startProcess(
      'indexer',
      'docker',
      [
        'run',
        '--rm',
        '--name',
        containerName,
        ...(process.platform === 'linux'
          ? ['--add-host', 'host.docker.internal:host-gateway']
          : []),
        '-p',
        `${DEFAULTS.indexerInternalPort}:${DEFAULTS.indexerInternalPort}`,
        '-p',
        `${DEFAULTS.indexerApiPort}:${DEFAULTS.indexerApiPort}`,
        '-e',
        `DATABASE_URL=postgres://saep:saep@host.docker.internal:5432/saep`,
        '-e',
        `INDEXER_ROLE=api`,
        '-e',
        `INDEXER_RUN_MIGRATIONS=1`,
        '-e',
        `HEALTHCHECK_PORT=${DEFAULTS.indexerInternalPort}`,
        '-e',
        `API_PORT=${DEFAULTS.indexerApiPort}`,
        '-e',
        `INDEXER_INTERNAL_API_TOKEN=${DEFAULTS.token}`,
        '-e',
        `RUST_LOG=${process.env.RUST_LOG ?? 'info,saep_indexer=debug'}`,
        'saep-indexer-smoke:local',
      ],
      {
        cwd: repoRoot,
        logPath: join(runLogDir, 'indexer.log'),
      },
    );
    cleanup.push(async () => stopProcess(indexer));
    cleanup.push(async () => {
      await runCommand(
        'remove indexer container',
        'docker',
        ['rm', '-f', containerName],
        {
          cwd: repoRoot,
          logPath: join(runLogDir, 'docker-indexer.log'),
        },
      ).catch(() => undefined);
    });

    await waitForHealth(
      'indexer internal health',
      `http://127.0.0.1:${DEFAULTS.indexerInternalPort}/healthz`,
      DEFAULTS.timeoutMs,
      DEFAULTS.pollMs,
      indexer,
    );
    await waitForHealth(
      'indexer public health',
      `http://127.0.0.1:${DEFAULTS.indexerApiPort}/healthz`,
      DEFAULTS.timeoutMs,
      DEFAULTS.pollMs,
      indexer,
    );

    console.log('Starting discovery...');
    const discovery = startProcess(
      'discovery',
      process.execPath,
      [resolve(repoRoot, 'services/discovery/dist/server.js')],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: DEFAULTS.databaseUrl,
          DISCOVERY_PORT: String(DEFAULTS.discoveryPort),
        },
        logPath: join(runLogDir, 'discovery.log'),
      },
    );
    cleanup.push(async () => stopProcess(discovery));

    await waitForHealth(
      'discovery health',
      `http://127.0.0.1:${DEFAULTS.discoveryPort}/healthz`,
      DEFAULTS.timeoutMs,
      DEFAULTS.pollMs,
      discovery,
    );

    console.log('Starting compute-broker...');
    const broker = startProcess(
      'compute-broker',
      process.execPath,
      [resolve(repoRoot, 'services/compute-broker/dist/server.js')],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: String(DEFAULTS.brokerPort),
          BROKER_SIGNING_KEY_HEX: DEFAULTS.signingKeyHex,
          COMPUTE_PROVIDER_MODE: 'mock',
          COMPUTE_BOND_STORE_PATH: join(runLogDir, 'compute-broker-state.json'),
          INDEXER_INTERNAL_API_URL: `http://127.0.0.1:${DEFAULTS.indexerInternalPort}`,
          INDEXER_INTERNAL_API_TOKEN: DEFAULTS.token,
        },
        logPath: join(runLogDir, 'compute-broker.log'),
      },
    );
    cleanup.push(async () => stopProcess(broker));

    await waitForHealth(
      'compute-broker health',
      `http://127.0.0.1:${DEFAULTS.brokerPort}/healthz`,
      DEFAULTS.timeoutMs,
      DEFAULTS.pollMs,
      broker,
    );

    console.log('Running compute-bond smoke flow...');
    await runCommand(
      'compute-bond smoke flow',
      'pnpm',
      [
        'smoke:compute-bonds',
        ...(options.smokeArgs.length > 0 ? ['--', ...options.smokeArgs] : []),
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          SAEP_COMPUTE_BROKER_URL: `http://127.0.0.1:${DEFAULTS.brokerPort}`,
          SAEP_DISCOVERY_URL: `http://127.0.0.1:${DEFAULTS.discoveryPort}`,
          SAEP_INDEXER_PUBLIC_URL: `http://127.0.0.1:${DEFAULTS.indexerApiPort}`,
        },
        logPath: join(runLogDir, 'smoke-command.log'),
      },
    );

    succeeded = true;
    console.log('Local compute-bond smoke stack passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Logs preserved at ${runLogDir}`);
    process.exitCode = 1;
  } finally {
    for (const task of cleanup.reverse()) {
      await task();
    }

    if (succeeded && !options.keepLogs) {
      await rm(runLogDir, { recursive: true, force: true });
    } else {
      console.log(`Logs available at ${runLogDir}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
