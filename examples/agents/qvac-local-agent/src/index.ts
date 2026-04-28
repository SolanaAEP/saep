import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildSubmitResultIx,
  fetchAgentByDid,
  fetchTasksByAgent,
  resolveCluster,
  taskMarketProgram,
  type SaepCluster,
  type TaskSummary,
} from '@saep/sdk';
import { buildExecutionCommitment } from './commitment.js';
import { buildCapabilityVector, scoreTaskAgainstCapabilities } from './capability.js';
import { runGroundedCompletion } from './grounded-completion.js';
import { ingestBriefs, searchBriefs } from './rag.js';
import { startRuntime, type Runtime } from './qvac-runtime.js';

type Config = {
  cluster: SaepCluster;
  rpcUrl?: string;
  keypairPath: string;
  agentDid: string;
  enableSubmit: boolean;
  pollMs: number;
  promptTemplate: string;
  briefsDir: string;
  capabilityThreshold: number;
};

function loadConfig(): Config {
  const agentDid = process.env.SAEP_AGENT_DID;
  if (!agentDid) throw new Error('SAEP_AGENT_DID is required');
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    cluster: (process.env.SAEP_CLUSTER ?? 'devnet') as SaepCluster,
    rpcUrl: process.env.SAEP_RPC_URL,
    keypairPath: process.env.SAEP_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
    agentDid,
    enableSubmit: process.env.SAEP_ENABLE_SUBMIT === 'true',
    pollMs: Number(process.env.SAEP_POLL_MS ?? '30000'),
    promptTemplate:
      process.env.SAEP_PROMPT_TEMPLATE ??
      'Task {taskHash} — produce the output specified by the matching capability for this brief. ' +
        'If multiple capabilities match, pick the one with the highest relevance score.',
    briefsDir: process.env.SAEP_BRIEFS_DIR ?? join(here, '..', 'briefs'),
    capabilityThreshold: Number(process.env.SAEP_CAPABILITY_THRESHOLD ?? '0.35'),
  };
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

function didToHex(input: string): string {
  return /^[0-9a-fA-F]{64}$/.test(input)
    ? input.toLowerCase()
    : Buffer.from(new PublicKey(input).toBytes()).toString('hex');
}

function buildPrompt(template: string, task: TaskSummary): string {
  const taskHashHex = Buffer.from(task.taskHash).toString('hex');
  return template.replaceAll('{taskHash}', taskHashHex);
}

type ChainCtx = {
  provider: AnchorProvider;
  market: ReturnType<typeof taskMarketProgram>;
  cluster: ReturnType<typeof resolveCluster>;
  operator: PublicKey;
  agentAccount: PublicKey;
};

async function processTask(
  task: TaskSummary,
  cfg: Config,
  rt: Runtime,
  capability: Awaited<ReturnType<typeof buildCapabilityVector>>,
  ctx: ChainCtx,
): Promise<void> {
  const taskHashHex = Buffer.from(task.taskHash).toString('hex').slice(0, 12);
  const prompt = buildPrompt(cfg.promptTemplate, task);

  const score = await scoreTaskAgainstCapabilities({
    embedId: rt.embedId,
    taskPrompt: prompt,
    capability,
  });
  console.log(`[qvac-agent] ${taskHashHex}.. capability score=${score.toFixed(3)}`);
  if (score < cfg.capabilityThreshold) {
    console.log(`[qvac-agent] ${taskHashHex}.. below threshold ${cfg.capabilityThreshold}, skipping`);
    return;
  }

  const groundingChunks = await searchBriefs({ embedId: rt.embedId, query: prompt, topK: 4 });
  console.log(
    `[qvac-agent] ${taskHashHex}.. retrieved ${groundingChunks.length} grounding chunks (top score ${groundingChunks[0]?.score.toFixed(3) ?? 'n/a'})`,
  );

  const { output } = await runGroundedCompletion({
    llmId: rt.llmId,
    taskPrompt: prompt,
    groundingChunks,
  });

  const commitment = buildExecutionCommitment({
    taskHash: task.taskHash,
    output,
    llmSrc: rt.llmSrc,
    embedSrc: rt.embedSrc,
  });
  console.log(
    `[qvac-agent] ${taskHashHex}.. produced ${output.length} chars, resultHash=${commitment.preimage.resultHashHex.slice(0, 12)}.. proofKey=${Buffer.from(commitment.proofKey).toString('hex').slice(0, 12)}..`,
  );

  if (!cfg.enableSubmit) {
    console.log(`[qvac-agent] ${taskHashHex}.. dry-run, skipping submitResult`);
    return;
  }

  const ix = await buildSubmitResultIx(ctx.market, ctx.cluster, {
    operator: ctx.operator,
    task: task.address,
    agentAccount: ctx.agentAccount,
    resultHash: commitment.resultHash,
    proofKey: commitment.proofKey,
  });
  const tx = new Transaction().add(ix);
  const sig = await ctx.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
  console.log(`[qvac-agent] ${taskHashHex}.. submitResult ${sig}`);
}

async function main() {
  const cfg = loadConfig();
  const keypair = loadKeypair(cfg.keypairPath);
  const cluster = resolveCluster({ cluster: cfg.cluster, endpoint: cfg.rpcUrl });
  const connection = new Connection(cluster.endpoint, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });
  const market = taskMarketProgram(provider, cluster);
  const registry = agentRegistryProgram(provider, cluster);

  const agentDidHex = didToHex(cfg.agentDid);
  const agent = await fetchAgentByDid(registry, agentDidHex);
  if (!agent) throw new Error(`Agent DID ${cfg.agentDid} not found`);
  if (!agent.operator.equals(keypair.publicKey)) {
    throw new Error(
      `Loaded keypair (${keypair.publicKey.toBase58()}) is not the agent operator (${agent.operator.toBase58()})`,
    );
  }

  const rt = await startRuntime();
  console.log(`[qvac-agent] models loaded — llm=${rt.llmId} embed=${rt.embedId}`);

  const ingestResult = await ingestBriefs({ embedId: rt.embedId, briefsDir: cfg.briefsDir });
  console.log(
    `[qvac-agent] ingested ${ingestResult.ingested} briefs (${ingestResult.skipped} skipped) into RAG workspace`,
  );

  const capability = await buildCapabilityVector({
    embedId: rt.embedId,
    briefSummary:
      'DeFi position summary, governance proposal digest, security incident triage, ' +
      'protocol research snapshot, treasury rebalance memo. Solana, on-chain agents, ' +
      'private operating context.',
  });
  console.log(`[qvac-agent] capability vector built (dim=${capability.embedding.length})`);

  const ctx: ChainCtx = {
    provider,
    market,
    cluster,
    operator: keypair.publicKey,
    agentAccount: agent.address,
  };
  const seen = new Set<string>();

  console.log(
    `[qvac-agent] agent=${agentDidHex.slice(0, 12)}.. operator=${keypair.publicKey.toBase58()} enableSubmit=${cfg.enableSubmit}`,
  );

  const shutdown = async () => {
    console.log('\n[qvac-agent] shutting down');
    await rt.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const scanOnce = async () => {
    const tasks = await fetchTasksByAgent(market, agentDidHex);
    const open = tasks.filter((t) => t.status === 'funded' && !t.verified);
    console.log(`[qvac-agent] scanning ${open.length} funded tasks`);
    for (const task of open) {
      const key = task.address.toBase58();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await processTask(task, cfg, rt, capability, ctx);
      } catch (err) {
        seen.delete(key);
        console.error(`[qvac-agent] task ${key} failed:`, err);
      }
    }
  };

  for (;;) {
    await scanOnce().catch((err) => console.error('[qvac-agent] scan failed:', err));
    await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
