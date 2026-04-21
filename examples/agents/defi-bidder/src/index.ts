import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildCommitBidIx,
  buildRevealBidIx,
  fetchAgentByDid,
  fetchBidBook,
  fetchRecentTasks,
  resolveCluster,
  taskMarketProgram,
  type SaepCluster,
} from '@saep/sdk';

type StoredBid = {
  amount: string;
  nonceHex: string;
};

type MintInfo = {
  decimals: number;
  tokenProgramId: PublicKey;
};

type Config = {
  cluster: SaepCluster;
  rpcUrl?: string;
  keypairPath: string;
  agentDid: string;
  agentIdHex: string;
  enableBids: boolean;
  maxSpendUi: string;
  bidPctBps: number;
  pollMs: number;
  nonceStore: string;
};

function loadConfig(): Config {
  const agentDid = process.env.SAEP_AGENT_DID;
  const agentIdHex = process.env.SAEP_AGENT_ID_HEX;
  if (!agentDid || !agentIdHex) {
    throw new Error('SAEP_AGENT_DID and SAEP_AGENT_ID_HEX are required');
  }
  return {
    cluster: (process.env.SAEP_CLUSTER ?? 'devnet') as SaepCluster,
    rpcUrl: process.env.SAEP_RPC_URL,
    keypairPath: process.env.SAEP_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
    agentDid,
    agentIdHex,
    enableBids: process.env.SAEP_ENABLE_BIDS === 'true',
    maxSpendUi: process.env.SAEP_MAX_SPEND_UI ?? '0.5',
    bidPctBps: Number(process.env.SAEP_BID_PCT_BPS ?? '8500'),
    pollMs: Number(process.env.SAEP_POLL_MS ?? '30000'),
    nonceStore: process.env.SAEP_NONCE_STORE ?? '.saep-defi-bids.json',
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

function hexToBytes(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'hex'));
}

function computeCommitHash(amount: bigint, nonce: Uint8Array): Uint8Array {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  return createHash('sha256').update(amountBuf).update(nonce).digest();
}

function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(`${whole}${padded}`);
}

function readStore(path: string): Record<string, StoredBid> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, StoredBid>;
  } catch {
    return {};
  }
}

function writeStore(path: string, store: Record<string, StoredBid>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
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
  if (!agent) {
    throw new Error(`Agent DID ${cfg.agentDid} not found`);
  }

  const mintCache = new Map<string, MintInfo>();
  const nonceStore = readStore(cfg.nonceStore);

  async function mintInfo(mint: PublicKey): Promise<MintInfo> {
    const key = mint.toBase58();
    const cached = mintCache.get(key);
    if (cached) return cached;
    const info = await connection.getAccountInfo(mint, 'confirmed');
    if (!info) throw new Error(`Mint ${key} not found`);
    const tokenProgramId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const mintMeta = await getMint(connection, mint, 'confirmed', tokenProgramId);
    const decimals = mintMeta.decimals;
    const resolved = { decimals, tokenProgramId };
    mintCache.set(key, resolved);
    return resolved;
  }

  const scanOnce = async () => {
    const tasks = await fetchRecentTasks(market, {
      limit: 25,
      statuses: ['created', 'funded', 'inExecution'],
    });

    console.log(`\n[defi-bidder] scanning ${tasks.length} recent tasks`);

    for (const task of tasks) {
      const bidBook = await fetchBidBook(market, task.taskId);
      if (!bidBook) continue;
      const taskIdHex = Buffer.from(task.taskId).toString('hex');
      const stored = nonceStore[taskIdHex];
      const meta = await mintInfo(task.paymentMint);
      const maxSpend = toBaseUnits(cfg.maxSpendUi, meta.decimals);

      if (task.paymentAmount > maxSpend) continue;

      if (bidBook.phase === 'commit' && !stored) {
        const bidAmount = (task.paymentAmount * BigInt(cfg.bidPctBps)) / 10_000n;
        console.log(`[candidate] ${taskIdHex.slice(0, 12)}.. reward=${task.paymentAmount} bid=${bidAmount}`);
        if (!cfg.enableBids) continue;

        const bidderTokenAccount = getAssociatedTokenAddressSync(
          task.paymentMint,
          keypair.publicKey,
          false,
          meta.tokenProgramId,
        );
        const nonce = randomBytes(32);
        const commitHash = computeCommitHash(bidAmount, nonce);
        const ix = await buildCommitBidIx(market, cluster, {
          bidder: keypair.publicKey,
          task: task.address,
          taskId: task.taskId,
          paymentMint: task.paymentMint,
          bidderTokenAccount,
          agentOperator: agent.operator,
          agentId: agent.agentId,
          agentDid: agent.did,
          commitHash,
          tokenProgramId: meta.tokenProgramId,
        });
        const tx = new Transaction().add(ix);
        const sig = await provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
        nonceStore[taskIdHex] = {
          amount: bidAmount.toString(),
          nonceHex: Buffer.from(nonce).toString('hex'),
        };
        writeStore(cfg.nonceStore, nonceStore);
        console.log(`[commit] ${taskIdHex.slice(0, 12)}.. ${sig}`);
      } else if (bidBook.phase === 'reveal' && stored) {
        console.log(`[reveal-ready] ${taskIdHex.slice(0, 12)}..`);
        if (!cfg.enableBids) continue;

        const ix = await buildRevealBidIx(market, {
          bidder: keypair.publicKey,
          task: task.address,
          taskId: task.taskId,
          amount: BigInt(stored.amount),
          nonce: Buffer.from(stored.nonceHex, 'hex'),
        });
        const tx = new Transaction().add(ix);
        const sig = await provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
        delete nonceStore[taskIdHex];
        writeStore(cfg.nonceStore, nonceStore);
        console.log(`[reveal] ${taskIdHex.slice(0, 12)}.. ${sig}`);
      }
    }
  };

  console.log(`[defi-bidder] agent=${agentDidHex} enableBids=${cfg.enableBids}`);
  for (;;) {
    await scanOnce().catch((err) => {
      console.error('[defi-bidder] scan failed:', err);
    });
    await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
