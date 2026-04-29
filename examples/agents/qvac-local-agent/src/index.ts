import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildSubmitResultIx,
  fetchAgentByDid,
  fetchRecentTasks,
  fetchTasksByAgent,
  resolveCluster,
  taskMarketProgram,
  type SaepCluster,
  type TaskSummary,
} from '@saep/sdk';
import {
  maybeCommitBid,
  maybeRevealBid,
  MintInfoCache,
  readStore,
  type BidConfig,
  type BidContext,
} from './bid.js';
import { buildExecutionCommitment } from './commitment.js';
import { buildCapabilityVector, scoreTaskAgainstCapabilities } from './capability.js';
import { runGroundedCompletion } from './grounded-completion.js';
import {
  artifactsAvailable,
  buildTaskCompletionProof,
  defaultCircuitArtifacts,
  paddedCircuitLabel,
  resultHashBytes,
  verifyProofLocally,
} from './proof.js';
import { ingestBriefs, searchBriefs } from './rag.js';
import { startRuntime, type Runtime } from './qvac-runtime.js';

type Config = {
  cluster: SaepCluster;
  rpcUrl?: string;
  keypairPath: string;
  agentDid: string;
  enableSubmit: boolean;
  enableBids: boolean;
  pollMs: number;
  promptTemplate: string;
  briefsDir: string;
  capabilityThreshold: number;
  bidThreshold: number;
  bid: BidConfig;
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
    enableBids: process.env.SAEP_ENABLE_BIDS === 'true',
    pollMs: Number(process.env.SAEP_POLL_MS ?? '30000'),
    promptTemplate:
      process.env.SAEP_PROMPT_TEMPLATE ??
      'Task {taskHash} — produce the output specified by the matching capability for this brief. ' +
        'If multiple capabilities match, pick the one with the highest relevance score.',
    briefsDir: process.env.SAEP_BRIEFS_DIR ?? join(here, '..', 'briefs'),
    capabilityThreshold: Number(process.env.SAEP_CAPABILITY_THRESHOLD ?? '0.35'),
    bidThreshold: Number(process.env.SAEP_BID_THRESHOLD ?? '0.40'),
    bid: {
      enableBids: process.env.SAEP_ENABLE_BIDS === 'true',
      maxSpendUi: process.env.SAEP_MAX_SPEND_UI ?? '0.5',
      bidPctBps: Number(process.env.SAEP_BID_PCT_BPS ?? '8500'),
      nonceStorePath: process.env.SAEP_NONCE_STORE ?? './.saep-qvac-bids.json',
    },
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

  let resultHash: Uint8Array;
  let proofKey: Uint8Array;
  let proofMode: 'groth16' | 'commitment';

  const artifacts = defaultCircuitArtifacts();
  if (artifactsAvailable(artifacts)) {
    const tStart = Date.now();
    const proven = await buildTaskCompletionProof({
      brief: prompt,
      output,
      deadline: task.deadline > 0 ? BigInt(task.deadline) : BigInt(Math.floor(Date.now() / 1000) + 3600),
      artifacts,
    });
    const proveMs = Date.now() - tStart;
    const valid = await verifyProofLocally(proven.proof, proven.publicSignals, artifacts);
    resultHash = resultHashBytes(proven.publicInputs.resultHash);
    proofKey = paddedCircuitLabel();
    proofMode = 'groth16';
    console.log(
      `[qvac-agent] ${taskHashHex}.. groth16 proof ${proveMs}ms verifiedLocally=${valid} resultHash=${Buffer.from(resultHash).toString('hex').slice(0, 12)}..`,
    );
  } else {
    const commitment = buildExecutionCommitment({
      taskHash: task.taskHash,
      output,
      llmSrc: rt.llmSrc,
      embedSrc: rt.embedSrc,
    });
    resultHash = commitment.resultHash;
    proofKey = commitment.proofKey;
    proofMode = 'commitment';
    console.log(
      `[qvac-agent] ${taskHashHex}.. commitment-only resultHash=${commitment.preimage.resultHashHex.slice(0, 12)}.. (artifacts missing)`,
    );
  }

  if (!cfg.enableSubmit) {
    console.log(`[qvac-agent] ${taskHashHex}.. dry-run (mode=${proofMode}), skipping submitResult`);
    return;
  }

  const ix = await buildSubmitResultIx(ctx.market, ctx.cluster, {
    operator: ctx.operator,
    task: task.address,
    agentAccount: ctx.agentAccount,
    resultHash,
    proofKey,
  });
  const tx = new Transaction().add(ix);
  const sig = await ctx.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
  console.log(`[qvac-agent] ${taskHashHex}.. submitResult (mode=${proofMode}) ${sig}`);
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

  const mintCache = new MintInfoCache(connection);
  const bidStore = readStore(cfg.bid.nonceStorePath);
  const bidCtx: BidContext = {
    provider,
    connection,
    cluster,
    market,
    keypair,
    agent,
    mintCache,
    store: bidStore,
    config: cfg.bid,
  };

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

  const scanBids = async () => {
    const tasks = await fetchRecentTasks(market, {
      limit: 25,
      statuses: ['created', 'funded', 'inExecution'],
    });
    if (tasks.length === 0) return;
    console.log(`[qvac-agent] bid-scan: ${tasks.length} candidate tasks`);
    for (const task of tasks) {
      const promptForScoring = buildPrompt(cfg.promptTemplate, task);
      const score = await scoreTaskAgainstCapabilities({
        embedId: rt.embedId,
        taskPrompt: promptForScoring,
        capability,
      });
      if (score < cfg.bidThreshold) continue;
      try {
        const reveal = await maybeRevealBid(bidCtx, task);
        if (reveal.revealed) {
          console.log(`[qvac-agent] bid-reveal ${Buffer.from(task.taskId).toString('hex').slice(0, 12)}.. ${reveal.signature}`);
          continue;
        }
        const commit = await maybeCommitBid(bidCtx, task);
        if (commit.committed) {
          console.log(
            `[qvac-agent] bid-commit ${Buffer.from(task.taskId).toString('hex').slice(0, 12)}.. amount=${commit.bidAmount} ${commit.signature}`,
          );
        } else if (commit.bidAmount && commit.reason === 'dry_run') {
          console.log(
            `[qvac-agent] bid-dryrun ${Buffer.from(task.taskId).toString('hex').slice(0, 12)}.. would-bid=${commit.bidAmount} score=${score.toFixed(3)}`,
          );
        }
      } catch (err) {
        console.error(
          `[qvac-agent] bid scan failed for ${Buffer.from(task.taskId).toString('hex').slice(0, 12)}..:`,
          err,
        );
      }
    }
  };

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
    await scanBids().catch((err) => console.error('[qvac-agent] bid-scan failed:', err));
    await scanOnce().catch((err) => console.error('[qvac-agent] scan failed:', err));
    await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
