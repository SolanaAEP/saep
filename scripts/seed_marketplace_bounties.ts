import { createHash } from 'node:crypto';
import * as anchor from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  MARKETPLACE_BOUNTIES,
  agentRegistryProgram,
  buildCreateTaskIx,
  buildFundTaskIx,
  buildOpenBiddingIx,
  fetchAgentByDid,
  fetchMarketGlobal,
  fetchTask,
  resolveCluster,
  taskMarketProgram,
  taskPda,
  type SaepCluster,
} from '@saep/sdk';

type CliOpts = {
  agentDids: string[];
  count: number;
  deadlineHours: number;
  mint?: string;
  preview: boolean;
  openBidding: boolean;
  symbol?: 'SOL' | 'SAEP';
};

const KNOWN_SYMBOLS: Record<string, 'SOL' | 'SAEP'> = {
  So11111111111111111111111111111111111111112: 'SOL',
  HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump: 'SAEP',
};

function usage(): never {
  console.error(
    [
      'Usage: pnpm tsx scripts/seed_marketplace_bounties.ts --agent-dids <did1,did2,...> [options]',
      '',
      'Options:',
      '  --count <n>           Number of bounties to seed (default: 12)',
      '  --deadline-hours <n>  Deadline offset in hours (default: 72)',
      '  --mint <pubkey>       Payment mint to use (default: first allowed task-market mint)',
      '  --symbol <SOL|SAEP>   Filter catalog by bounty mint theme when auto-detect is ambiguous',
      '  --open-bidding        Open bidding windows after create+fund',
      '  --preview             Print intended actions without sending transactions',
    ].join('\n'),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    agentDids: [],
    count: 12,
    deadlineHours: 72,
    preview: false,
    openBidding: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--preview') {
      opts.preview = true;
      continue;
    }
    if (arg === '--open-bidding') {
      opts.openBidding = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next) usage();
    if (arg === '--agent-dids') {
      opts.agentDids = next.split(',').map((value) => value.trim()).filter(Boolean);
      i++;
      continue;
    }
    if (arg === '--count') {
      opts.count = Number(next);
      i++;
      continue;
    }
    if (arg === '--deadline-hours') {
      opts.deadlineHours = Number(next);
      i++;
      continue;
    }
    if (arg === '--mint') {
      opts.mint = next;
      i++;
      continue;
    }
    if (arg === '--symbol') {
      if (next !== 'SOL' && next !== 'SAEP') usage();
      opts.symbol = next;
      i++;
      continue;
    }
    usage();
  }

  if (opts.agentDids.length === 0 || Number.isNaN(opts.count) || Number.isNaN(opts.deadlineHours)) {
    usage();
  }

  return opts;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function parseDid(input: string): string {
  const value = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase();
  }
  return toHex(new PublicKey(value).toBytes());
}

function deterministicNonce(slug: string): Uint8Array {
  return createHash('sha256')
    .update(`saep-market-bounty:${slug}`)
    .digest()
    .subarray(0, 8);
}

function toBaseUnits(amount: string, decimals: number): bigint {
  const normalized = amount.trim();
  const [whole, fraction = ''] = normalized.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`invalid amount: ${amount}`);
  }
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(`${whole}${padded}`);
}

function detectSymbol(mint: PublicKey, explicit?: 'SOL' | 'SAEP'): 'SOL' | 'SAEP' {
  return explicit ?? KNOWN_SYMBOLS[mint.toBase58()] ?? (() => {
    throw new Error(
      `Unable to infer bounty theme for mint ${mint.toBase58()}. Pass --symbol SOL or --symbol SAEP.`,
    );
  })();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const clusterName = (process.env.SAEP_CLUSTER ?? 'devnet') as SaepCluster;
  const config = resolveCluster({
    cluster: clusterName,
    endpoint: provider.connection.rpcEndpoint,
    programIds: {
      ...(process.env.SAEP_TASK_MARKET_PROGRAM_ID ? { taskMarket: process.env.SAEP_TASK_MARKET_PROGRAM_ID } : {}),
      ...(process.env.SAEP_AGENT_REGISTRY_PROGRAM_ID ? { agentRegistry: process.env.SAEP_AGENT_REGISTRY_PROGRAM_ID } : {}),
    },
  });

  const market = taskMarketProgram(provider, config);
  const registry = agentRegistryProgram(provider, config);
  const payer = provider.wallet.publicKey;
  const global = await fetchMarketGlobal(market);
  if (!global) {
    throw new Error('task_market global account is missing; run bootstrap first');
  }

  const paymentMint = opts.mint
    ? new PublicKey(opts.mint)
    : global.allowedPaymentMints[0];
  if (!paymentMint) {
    throw new Error('task_market has no allowed payment mints configured');
  }
  if (!global.allowedPaymentMints.some((mint) => mint.equals(paymentMint))) {
    throw new Error(`mint ${paymentMint.toBase58()} is not allowed by task_market`);
  }

  const mintAccount = await provider.connection.getAccountInfo(paymentMint, 'confirmed');
  if (!mintAccount) {
    throw new Error(`payment mint ${paymentMint.toBase58()} not found`);
  }
  const tokenProgramId = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : mintAccount.owner.equals(TOKEN_PROGRAM_ID)
      ? TOKEN_PROGRAM_ID
      : null;
  if (!tokenProgramId) {
    throw new Error('selected payment mint is not owned by SPL Token or Token-2022');
  }

  const mintMeta = await getMint(provider.connection, paymentMint, 'confirmed', tokenProgramId);
  const payerTokenAccount = getAssociatedTokenAddressSync(paymentMint, payer, false, tokenProgramId);
  const bountyTheme = detectSymbol(paymentMint, opts.symbol);
  const selectedBounties = MARKETPLACE_BOUNTIES
    .filter((bounty) => bounty.suggestedMint === bountyTheme)
    .slice(0, opts.count);

  if (selectedBounties.length === 0) {
    throw new Error(`No catalog bounties matched theme ${bountyTheme}`);
  }

  const resolvedAgents = await Promise.all(opts.agentDids.map(async (didLike) => {
    const didHex = parseDid(didLike);
    const agent = await fetchAgentByDid(registry, didHex);
    if (!agent) {
      throw new Error(`agent DID not found in registry: ${didLike}`);
    }
    if (agent.status !== 'active') {
      throw new Error(`agent ${didLike} is not active`);
    }
    return agent;
  }));

  console.log(`payer: ${payer.toBase58()}`);
  console.log(`payment mint: ${paymentMint.toBase58()} (${bountyTheme}, ${mintMeta.decimals} decimals)`);
  console.log(`using ${resolvedAgents.length} agent DID(s) across ${selectedBounties.length} bounty seeds`);

  for (let index = 0; index < selectedBounties.length; index++) {
    const bounty = selectedBounties[index];
    const nonce = deterministicNonce(bounty.slug);
    const [taskAddress] = taskPda(market.programId, payer, nonce);
    const existing = await fetchTask(market, payer, nonce);
    const agent = resolvedAgents[index % resolvedAgents.length];
    const amount = toBaseUnits(bounty.rewardUi, mintMeta.decimals);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + opts.deadlineHours * 3600);
    const derivedTaskHash = createHash('sha256').update(bounty.prompt).digest('hex');
    if (derivedTaskHash !== bounty.taskHash) {
      throw new Error(`catalog hash mismatch for ${bounty.slug}`);
    }

    console.log(`\n[${index + 1}/${selectedBounties.length}] ${bounty.title}`);
    console.log(`  task: ${taskAddress.toBase58()}`);
    console.log(`  agent: ${toHex(agent.did)} (${agent.address.toBase58()})`);
    console.log(`  reward: ${bounty.rewardUi} ${bountyTheme}`);

    if (existing) {
      console.log(`  skip: already exists with status=${existing.status}`);
      continue;
    }

    if (opts.preview) {
      console.log('  preview: create + fund only');
      if (opts.openBidding) console.log('  preview: open bidding after create');
      continue;
    }

    const createIx = await buildCreateTaskIx(market, config, {
      client: payer,
      taskNonce: nonce,
      agentDid: agent.did,
      agentOperator: agent.operator,
      agentId: agent.agentId,
      paymentMint,
      paymentAmount: amount,
      taskHash: Uint8Array.from(Buffer.from(bounty.taskHash, 'hex')),
      criteriaRoot: new Uint8Array(32),
      deadline,
      milestoneCount: 0,
    });
    const fundIx = await buildFundTaskIx(market, {
      client: payer,
      task: taskAddress,
      paymentMint,
      clientTokenAccount: payerTokenAccount,
      tokenProgramId,
    });

    const tx = new Transaction().add(createIx, fundIx);
    const sig = await provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
    console.log(`  funded: ${sig}`);

    if (opts.openBidding) {
      const createdTask = await fetchTask(market, payer, nonce);
      if (!createdTask) {
        throw new Error(`task ${taskAddress.toBase58()} missing immediately after funding`);
      }
      const openBidIx = await buildOpenBiddingIx(market, {
        client: payer,
        task: taskAddress,
        taskId: createdTask.taskId,
        paymentMint,
        commitSecs: 6n * 60n * 60n,
        revealSecs: 6n * 60n * 60n,
        bondBps: 500,
        tokenProgramId,
      });
      const bidTx = new Transaction().add(openBidIx);
      const bidSig = await provider.sendAndConfirm(bidTx, [], { commitment: 'confirmed' });
      console.log(`  bidding opened: ${bidSig}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
