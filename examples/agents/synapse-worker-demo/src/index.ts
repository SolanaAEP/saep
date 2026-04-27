import { Keypair, Connection } from '@solana/web3.js';
import { createSynapsePlugin, type SynapseToolDefinition } from '@saep/synapse-plugin';
import { resolveCluster } from '@saep/sdk';

const CLUSTER = 'devnet' as const;
const SYNAPSE_RPC = env('SYNAPSE_RPC_URL', 'http://localhost:8550');
const SYNAPSE_WS = env('SYNAPSE_WS_URL');
const KEYPAIR_PATH = env('SAEP_OPERATOR_KEYPAIR', '');
const METADATA_URI = env('SAEP_METADATA_URI', 'https://arweave.net/saep-synapse-demo');
const CAPABILITY_BITS = [2];
const STAKE_MINT = env('SAEP_STAKE_MINT', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const BID_FRACTION = 0.85;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 60_000;
const POLL_STEP_MS = 3_000;

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (!val && fallback === undefined) throw new Error(`missing env: ${key}`);
  return val ?? fallback!;
}

async function loadKeypair(): Promise<Keypair> {
  if (!KEYPAIR_PATH) return Keypair.generate();
  const fs = await import('node:fs');
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTool(tools: SynapseToolDefinition[], name: string): SynapseToolDefinition {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

type R = Record<string, unknown>;

async function pollForStatus(
  getTask: SynapseToolDefinition,
  taskAddr: string,
  statuses: string[],
): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_STEP_MS);
    const detail = (await getTask.handler({ task_address: taskAddr })) as R;
    if (statuses.includes(detail.status as string)) return true;
  }
  return false;
}

async function ensureRegistered(plugin: ReturnType<typeof createSynapsePlugin>, keypair: Keypair): Promise<string> {
  const rep = (await getTool(plugin.tools, 'saep_get_reputation').handler({})) as R;

  if (rep.error === 'no_agent_for_operator') {
    console.log('  no agent found, registering...');
    const ata = env('SAEP_OPERATOR_TOKEN_ACCOUNT', keypair.publicKey.toBase58());
    const result = (await getTool(plugin.tools, 'saep_register_agent').handler({
      capability_bits: CAPABILITY_BITS,
      metadata_uri: METADATA_URI,
      stake_mint: STAKE_MINT,
      operator_token_account: ata,
    })) as R;
    if (result.error) throw new Error(`registration failed: ${JSON.stringify(result)}`);
    console.log(`  registered: ${result.agent_did_hex}`);
    return result.agent_did_hex as string;
  }

  console.log(`  already registered: ${rep.agent_did_hex}`);
  return rep.agent_did_hex as string;
}

async function processTask(
  tools: SynapseToolDefinition[],
  taskAddr: string,
  reward: number,
  agentDidHex: string,
  bidToken: string,
): Promise<void> {
  const bidAmount = Math.floor(reward * BID_FRACTION);
  if (bidAmount <= 0) return;

  console.log(`\n  task ${taskAddr} (reward: ${reward})`);

  const bidResult = (await getTool(tools, 'saep_bid').handler({
    task_address: taskAddr,
    amount_usdc_micro: bidAmount,
    agent_did_hex: agentDidHex,
    bidder_token_account: bidToken,
  })) as R;
  if (bidResult.error) { console.log(`  bid error: ${bidResult.error}`); return; }
  console.log(`  bid: ${bidResult.signature}`);

  const revealResult = (await getTool(tools, 'saep_reveal_bid').handler({
    task_address: taskAddr,
    amount_usdc_micro: bidAmount,
  })) as R;
  if (revealResult.error) { console.log(`  reveal error: ${revealResult.error}`); return; }
  console.log(`  reveal: ${revealResult.signature}`);

  console.log('  awaiting award...');
  if (!await pollForStatus(getTool(tools, 'saep_get_task'), taskAddr, ['inExecution'])) {
    console.log('  award timed out'); return;
  }

  const submitResult = (await getTool(tools, 'saep_submit_result').handler({
    task_address: taskAddr,
    result_hash: '00'.repeat(32),
    proof_key: '00'.repeat(32),
  })) as R;
  if (submitResult.error) { console.log(`  submit error: ${submitResult.error}`); return; }
  console.log(`  submit: ${submitResult.signature}`);

  console.log('  awaiting verification...');
  if (!await pollForStatus(getTool(tools, 'saep_get_task'), taskAddr, ['verified', 'released'])) {
    console.log('  verify timed out'); return;
  }

  const claimResult = (await getTool(tools, 'saep_claim_payout').handler({
    task_address: taskAddr,
  })) as R;
  if (claimResult.error) { console.log(`  claim error: ${claimResult.error}`); return; }
  console.log(`  claim: ${claimResult.signature}`);
  console.log('  lifecycle complete');
}

async function main() {
  const keypair = await loadKeypair();
  const config = resolveCluster({ cluster: CLUSTER });
  const connection = new Connection(config.endpoint, 'confirmed');

  console.log(`operator: ${keypair.publicKey.toBase58()}`);
  console.log(`cluster:  ${CLUSTER}`);
  console.log(`synapse:  ${SYNAPSE_RPC}`);

  const plugin = createSynapsePlugin({
    cluster: CLUSTER,
    connection,
    wallet: {
      publicKey: keypair.publicKey,
      async signTransaction(tx) {
        (tx as import('@solana/web3.js').Transaction).sign(keypair);
        return tx;
      },
    },
    synapse: {
      rpcUrl: SYNAPSE_RPC,
      wsUrl: SYNAPSE_WS || undefined,
    },
    discoveryUrl: env('SAEP_DISCOVERY_URL', ''),
    maxAutoSignLamports: 5_000_000,
    velocityLimit: 20,
  });

  console.log('\nregistering with synapse...');
  const { sessionId } = await plugin.register('synapse-worker-demo', ['code_gen']);
  console.log(`session: ${sessionId}`);

  console.log('\nchecking saep registration...');
  const agentDidHex = await ensureRegistered(plugin, keypair);

  plugin.feed.on((event) => console.log(`feed: ${event.type} task=${event.taskAddress}`));
  plugin.feed.start();

  const bidToken = env('SAEP_BID_TOKEN_ACCOUNT', keypair.publicKey.toBase58());

  async function cycle() {
    try {
      const discovered = (await getTool(plugin.tools, 'saep_discover_tasks').handler({
        status: 'open',
        limit: 5,
      })) as { tasks?: R[] };

      const tasks = discovered.tasks ?? [];
      if (tasks.length === 0) { console.log('  no open tasks'); return; }

      for (const task of tasks) {
        await processTask(
          plugin.tools,
          task.task_address as string,
          Number(task.payment_amount),
          agentDidHex,
          bidToken,
        );
      }
    } catch (err) {
      console.error('cycle error:', err);
    }
  }

  await cycle();
  setInterval(cycle, POLL_INTERVAL_MS);
  console.log(`\nworker running, polling every ${POLL_INTERVAL_MS / 1000}s`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
