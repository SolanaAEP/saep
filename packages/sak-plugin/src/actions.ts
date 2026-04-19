import { z } from 'zod';
import { PublicKey, Transaction } from '@solana/web3.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  agentRegistryProgram,
  taskMarketProgram,
  treasuryStandardProgram,
  makeProvider,
  resolveCluster,
  buildRegisterAgentIx,
  buildSubmitResultIx,
  buildCommitBidIx,
  buildRevealBidIx,
  buildWithdrawIx,
  encodeAgentId,
  fetchAgentsByOperator,
  fetchAgentByDid,
  fetchTasksByAgent,
  fetchTreasury,
  fetchVaultBalances,
  fetchAllowedMints,
} from '@saep/sdk';
import type { Action, SaepPluginOptions, SakAgentLike, SakCluster, SakWallet } from './types.js';

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Hex32 = z.string().regex(/^[0-9a-f]{64}$/i);

const PIN_TO_SAEP_CLUSTER = (c: SakCluster) => c;

function toBrowserWallet(w: SakWallet) {
  const signAll =
    w.signAllTransactions?.bind(w) ??
    (async <T>(txs: T[]): Promise<T[]> => {
      const out: T[] = [];
      for (const tx of txs) out.push(await (w.signTransaction as (t: T) => Promise<T>)(tx));
      return out;
    });
  return {
    publicKey: w.publicKey,
    signTransaction: w.signTransaction.bind(w),
    signAllTransactions: signAll,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error('expected 32-byte hex');
  return Uint8Array.from(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function capabilityMaskFrom(bits: number[]): bigint {
  return bits.reduce((m, b) => m | (1n << BigInt(b)), 0n);
}

function randomAgentId(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

const autoSignTimestamps: number[] = [];

function checkVelocity(limit: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (autoSignTimestamps.length > 0 && autoSignTimestamps[0]! < windowStart) {
    autoSignTimestamps.shift();
  }
  return autoSignTimestamps.length < limit;
}

function recordAutoSign(): void {
  autoSignTimestamps.push(Date.now());
}

export function _resetVelocityWindow(): void {
  autoSignTimestamps.length = 0;
}

const DEFAULT_MAX_LAMPORTS = 1_000_000;
const DEFAULT_VELOCITY_LIMIT = 10;

function enforceGuardrails(opts: SaepPluginOptions | undefined, valueLamports?: number): void {
  const maxLamports = opts?.maxAutoSignLamports ?? DEFAULT_MAX_LAMPORTS;
  const velocityLimit = opts?.velocityLimit ?? DEFAULT_VELOCITY_LIMIT;
  if (valueLamports !== undefined && valueLamports > maxLamports) {
    throw new Error(
      `Auto-sign rejected: transaction value ${valueLamports} lamports exceeds cap ${maxLamports}. ` +
      `Ask the human to sign manually or increase maxAutoSignLamports.`,
    );
  }
  if (!checkVelocity(velocityLimit)) {
    throw new Error(
      `Auto-sign rejected: velocity limit exceeded (${velocityLimit} transactions per 60s window). ` +
      `Wait before submitting more transactions or ask the human to sign manually.`,
    );
  }
  recordAutoSign();
}

function contextFor(agent: SakAgentLike, cluster: SakCluster) {
  const config = resolveCluster({ cluster: PIN_TO_SAEP_CLUSTER(cluster) });
  const provider = makeProvider({
    connection: agent.connection,
    wallet: toBrowserWallet(agent.wallet),
  });
  return { config, provider };
}

export function saepRegisterAgentAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  const schema = z.object({
    capability_bits: z.array(z.number().int().min(0).max(127)).min(1),
    metadata_uri: z.string().url(),
    agent_id_seed: z.string().max(32).optional(),
    stake_amount: z.string().regex(/^\d+$/).default('0'),
    stake_mint: Base58,
    operator_token_account: Base58,
    price_lamports: z.string().regex(/^\d+$/).default('0'),
    stream_rate: z.string().regex(/^\d+$/).default('0'),
  });
  return {
    name: 'SAEP_REGISTER_AGENT',
    similes: [
      'register my agent with saep',
      'sign up on saep marketplace',
      'create saep agent account',
    ],
    description:
      'One-time bootstrap: registers the SAK wallet as a SAEP operator and creates an AgentAccount. ' +
      'Args: { capability_bits[], metadata_uri, stake_mint, operator_token_account, agent_id_seed?, ' +
      'stake_amount?, price_lamports?, stream_rate? }. Returns { signature, agent_address, agent_did_hex }.',
    examples: [
      {
        input: 'Register me for code_gen with my USDC stake account',
        output:
          'SAEP_REGISTER_AGENT { capability_bits: [2], metadata_uri: "https://...", ' +
          'stake_mint: "EPjFWdd...", operator_token_account: "9ATA...", stake_amount: "1000000" }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const program = agentRegistryProgram(provider, config);
      const agentId = input.agent_id_seed
        ? encodeAgentId(input.agent_id_seed)
        : randomAgentId();

      const ix = await buildRegisterAgentIx(program, {
        operator: agent.wallet.publicKey,
        agentId,
        manifestUri: input.metadata_uri,
        capabilityMask: capabilityMaskFrom(input.capability_bits),
        priceLamports: BigInt(input.price_lamports),
        streamRate: BigInt(input.stream_rate),
        stakeAmount: BigInt(input.stake_amount),
        stakeMint: new PublicKey(input.stake_mint),
        operatorTokenAccount: new PublicKey(input.operator_token_account),
        capabilityRegistryProgramId: config.programIds.capabilityRegistry,
      });

      const tx = new Transaction().add(ix);
      enforceGuardrails(opts);
      const signature = await provider.sendAndConfirm(tx);

      const fetched = await fetchAgentsByOperator(program, agent.wallet.publicKey);
      const created = fetched.find(
        (a) => Buffer.from(a.agentId).equals(Buffer.from(agentId)),
      );
      return {
        cluster,
        signature,
        agent_address: created?.address.toBase58() ?? null,
        agent_did_hex: created ? bytesToHex(created.did) : null,
        agent_id_hex: bytesToHex(agentId),
      };
    },
  };
}

export function saepListTasksAction(cluster: SakCluster, _opts?: SaepPluginOptions): Action {
  const schema = z.object({
    agent_did_hex: Hex32.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  });
  return {
    name: 'SAEP_LIST_TASKS',
    similes: [
      'find my saep tasks',
      'list tasks assigned to me',
      'what jobs do i have',
      'show my task queue',
    ],
    description:
      'Lists SAEP tasks assigned to this operator. If agent_did_hex omitted, resolves to the first ' +
      'active agent owned by the wallet. Args: { agent_did_hex?, limit? }.',
    examples: [
      {
        input: 'Show me my open tasks',
        output: 'SAEP_LIST_TASKS {}',
      },
      {
        input: 'List tasks for agent DID 4af3...',
        output: 'SAEP_LIST_TASKS { agent_did_hex: "4af3..." }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const tm = taskMarketProgram(provider, config);

      let did = input.agent_did_hex;
      if (!did) {
        const ar = agentRegistryProgram(provider, config);
        const mine = await fetchAgentsByOperator(ar, agent.wallet.publicKey);
        const active = mine.find((a) => a.status === 'active') ?? mine[0];
        if (!active) {
          return { cluster, tasks: [], error: 'no_agent_for_operator' };
        }
        did = bytesToHex(active.did);
      }

      const tasks = await fetchTasksByAgent(tm, did);
      const out = tasks.slice(0, input.limit).map((t) => ({
        task_address: t.address.toBase58(),
        task_id_hex: bytesToHex(t.taskId),
        client: t.client.toBase58(),
        payment_mint: t.paymentMint.toBase58(),
        payment_amount: t.paymentAmount.toString(),
        status: t.status,
        verified: t.verified,
        deadline: t.deadline,
        created_at: t.createdAt,
      }));
      return { cluster, agent_did_hex: did, tasks: out };
    },
  };
}

function amountLe(amount: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = amount;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function randomNonce(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

function commitHash(amount: bigint, nonce: Uint8Array, agentDid: Uint8Array): Uint8Array {
  const buf = new Uint8Array(8 + 32 + 32);
  buf.set(amountLe(amount), 0);
  buf.set(nonce, 8);
  buf.set(agentDid, 40);
  return keccak_256(buf);
}

export function saepBidAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  const schema = z.object({
    task_address: Base58,
    amount_usdc_micro: z.number().int().positive(),
    agent_did_hex: Hex32,
    bidder_token_account: Base58,
  });
  return {
    name: 'SAEP_BID',
    similes: [
      'bid on saep task',
      'take this job',
      'submit a bid',
      'compete for that task',
    ],
    description:
      'Commit phase of a commit-reveal bid. Stores commit_hash + posts bond. Returns nonce + amount — ' +
      'caller MUST persist these to reveal later via SAEP_REVEAL_BID before the reveal window closes. ' +
      'Args: { task_address, amount_usdc_micro, agent_did_hex, bidder_token_account }.',
    examples: [
      {
        input: 'Bid 50 cents on task 7xK2... using agent 4af3... and USDC account 9ATA...',
        output:
          'SAEP_BID { task_address: "7xK2...", amount_usdc_micro: 500000, ' +
          'agent_did_hex: "4af3...", bidder_token_account: "9ATA..." }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const tm = taskMarketProgram(provider, config);
      const ar = agentRegistryProgram(provider, config);

      const taskPk = new PublicKey(input.task_address);
      const task = await tm.account.taskContract.fetch(taskPk);
      const taskId = Uint8Array.from(task.taskId as number[]);
      const paymentMint = task.paymentMint as PublicKey;

      const agentAcc = await fetchAgentByDid(ar, input.agent_did_hex);
      if (!agentAcc) {
        return { cluster, error: 'agent_not_found', agent_did_hex: input.agent_did_hex };
      }
      if (!agentAcc.operator.equals(agent.wallet.publicKey)) {
        return {
          cluster,
          error: 'operator_mismatch',
          reason: 'wallet is not the registered operator for this agent_did',
        };
      }

      const agentDid = hexToBytes(input.agent_did_hex);
      const amount = BigInt(input.amount_usdc_micro);
      const nonce = randomNonce();
      const hash = commitHash(amount, nonce, agentDid);

      const ix = await buildCommitBidIx(tm, config, {
        bidder: agent.wallet.publicKey,
        task: taskPk,
        taskId,
        paymentMint,
        bidderTokenAccount: new PublicKey(input.bidder_token_account),
        agentOperator: agentAcc.operator,
        agentId: agentAcc.agentId,
        agentDid,
        commitHash: hash,
      });
      const tx = new Transaction().add(ix);
      enforceGuardrails(opts);
      const signature = await provider.sendAndConfirm(tx);

      return {
        cluster,
        signature,
        nonce_hex: bytesToHex(nonce),
        amount_usdc_micro: input.amount_usdc_micro,
        agent_did_hex: input.agent_did_hex,
        task_id_hex: bytesToHex(taskId),
        warning: 'PERSIST nonce_hex — required for SAEP_REVEAL_BID. Loss forfeits bond.',
      };
    },
  };
}

export function saepRevealBidAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  const schema = z.object({
    task_address: Base58,
    amount_usdc_micro: z.number().int().positive(),
    nonce_hex: Hex32,
  });
  return {
    name: 'SAEP_REVEAL_BID',
    similes: [
      'reveal my saep bid',
      'open the sealed bid',
      'submit bid reveal',
    ],
    description:
      'Reveal phase: submits the (amount, nonce) committed via SAEP_BID. Must land during the reveal ' +
      'window or the bond is slashed. Args: { task_address, amount_usdc_micro, nonce_hex }.',
    examples: [
      {
        input: 'Reveal my 500000 micro-USDC bid on task 7xK2... with nonce abc1...',
        output:
          'SAEP_REVEAL_BID { task_address: "7xK2...", amount_usdc_micro: 500000, nonce_hex: "abc1..." }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const tm = taskMarketProgram(provider, config);

      const taskPk = new PublicKey(input.task_address);
      const task = await tm.account.taskContract.fetch(taskPk);
      const taskId = Uint8Array.from(task.taskId as number[]);

      const ix = await buildRevealBidIx(tm, {
        bidder: agent.wallet.publicKey,
        task: taskPk,
        taskId,
        amount: BigInt(input.amount_usdc_micro),
        nonce: hexToBytes(input.nonce_hex),
      });
      const tx = new Transaction().add(ix);
      enforceGuardrails(opts);
      const signature = await provider.sendAndConfirm(tx);
      return { cluster, signature, task_id_hex: bytesToHex(taskId) };
    },
  };
}

export function saepSubmitResultAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  const schema = z.object({
    task_address: Base58,
    result_hash: Hex32,
    proof_key: Hex32,
  });
  return {
    name: 'SAEP_SUBMIT_RESULT',
    similes: [
      'submit my work for saep task',
      'deliver the result',
      'finalize saep task completion',
    ],
    description:
      'Submit result for an assigned task. Derives the agent account from the task\'s agent_did. ' +
      'Args: { task_address (base58), result_hash (hex32), proof_key (hex32) }.',
    examples: [
      {
        input: 'Submit result for task 7xK2... with hash 4af3... and proof_key 0001...',
        output:
          'SAEP_SUBMIT_RESULT { task_address: "7xK2...", result_hash: "4af3...", proof_key: "0001..." }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const tm = taskMarketProgram(provider, config);
      const ar = agentRegistryProgram(provider, config);

      const taskPk = new PublicKey(input.task_address);
      const task = await tm.account.taskContract.fetch(taskPk);
      const didHex = bytesToHex(Uint8Array.from(task.agentDid as number[]));
      const agentAcc = await fetchAgentByDid(ar, didHex);
      if (!agentAcc) {
        return {
          cluster,
          error: 'agent_not_found_for_task',
          agent_did_hex: didHex,
        };
      }

      const ix = await buildSubmitResultIx(tm, config, {
        operator: agent.wallet.publicKey,
        task: taskPk,
        agentAccount: agentAcc.address,
        resultHash: hexToBytes(input.result_hash),
        proofKey: hexToBytes(input.proof_key),
      });
      const tx = new Transaction().add(ix);
      enforceGuardrails(opts);
      const signature = await provider.sendAndConfirm(tx);
      return { cluster, signature, agent_did_hex: didHex };
    },
  };
}

export function saepCheckReputationAction(cluster: SakCluster, _opts?: SaepPluginOptions): Action {
  const schema = z.object({
    agent_did_hex: Hex32.optional(),
  });
  return {
    name: 'SAEP_CHECK_REPUTATION',
    similes: [
      'check my saep reputation',
      'what is my agent score',
      'show agent reputation',
      'how am i performing on saep',
    ],
    description:
      'Check reputation and treasury status for an agent. If agent_did_hex omitted, resolves to the ' +
      'first active agent owned by the wallet. Returns on-chain agent status, capability mask, stake, ' +
      'treasury limits, and vault balances.',
    examples: [
      { input: 'Check my reputation', output: 'SAEP_CHECK_REPUTATION {}' },
      { input: 'Check agent 4af3...', output: 'SAEP_CHECK_REPUTATION { agent_did_hex: "4af3..." }' },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const ar = agentRegistryProgram(provider, config);
      const ts = treasuryStandardProgram(provider, config);

      let didHex = input.agent_did_hex;
      let agentAcc;
      if (didHex) {
        agentAcc = await fetchAgentByDid(ar, didHex);
      } else {
        const mine = await fetchAgentsByOperator(ar, agent.wallet.publicKey);
        agentAcc = mine.find((a) => a.status === 'active') ?? mine[0];
        if (agentAcc) didHex = bytesToHex(agentAcc.did);
      }

      if (!agentAcc || !didHex) {
        return { cluster, error: 'agent_not_found' };
      }

      const treasury = await fetchTreasury(ts, agentAcc.did);
      const mints = await fetchAllowedMints(ts);
      const vaults = mints.length > 0
        ? await fetchVaultBalances(ts, agentAcc.did, mints)
        : [];

      return {
        cluster,
        agent_did_hex: didHex,
        agent_address: agentAcc.address.toBase58(),
        operator: agentAcc.operator.toBase58(),
        status: agentAcc.status,
        capability_mask: agentAcc.capabilityMask.toString(),
        stake_amount: agentAcc.stakeAmount?.toString() ?? '0',
        treasury: treasury ? {
          daily_spend_limit: treasury.dailySpendLimit.toString(),
          per_tx_limit: treasury.perTxLimit.toString(),
          weekly_limit: treasury.weeklyLimit.toString(),
          spent_today: treasury.spentToday.toString(),
          spent_this_week: treasury.spentThisWeek.toString(),
          streaming_active: treasury.streamingActive,
        } : null,
        vaults: vaults.filter((v) => v.exists).map((v) => ({
          mint: v.mint.toBase58(),
          amount: v.amount.toString(),
        })),
      };
    },
  };
}

export function saepWithdrawAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  const schema = z.object({
    agent_did_hex: Hex32,
    mint: Base58,
    destination: Base58,
    amount: z.string().regex(/^\d+$/),
    price_feed: Base58.optional(),
  });
  return {
    name: 'SAEP_WITHDRAW',
    similes: [
      'withdraw my saep earnings',
      'cash out from saep',
      'take my money out',
      'withdraw from agent treasury',
    ],
    description:
      'Withdraw funds from the agent treasury vault. Requires operator to be the wallet signer. ' +
      'Amount is in raw token units (micro-USDC for USDC). Optional price_feed for cross-mint limit enforcement. ' +
      'Args: { agent_did_hex, mint, destination, amount, price_feed? }.',
    examples: [
      {
        input: 'Withdraw 10 USDC from my agent treasury',
        output:
          'SAEP_WITHDRAW { agent_did_hex: "4af3...", mint: "EPjFWdd...", ' +
          'destination: "9ATA...", amount: "10000000" }',
      },
    ],
    schema,
    handler: async (agent, input) => {
      const { config, provider } = contextFor(agent, cluster);
      const ts = treasuryStandardProgram(provider, config);

      const ix = await buildWithdrawIx(ts, {
        operator: agent.wallet.publicKey,
        agentDid: hexToBytes(input.agent_did_hex),
        mint: new PublicKey(input.mint),
        destination: new PublicKey(input.destination),
        amount: BigInt(input.amount),
        priceFeed: input.price_feed ? new PublicKey(input.price_feed) : undefined,
      });
      const tx = new Transaction().add(ix);
      enforceGuardrails(opts);
      const signature = await provider.sendAndConfirm(tx);
      return {
        cluster,
        signature,
        agent_did_hex: input.agent_did_hex,
        mint: input.mint,
        amount: input.amount,
      };
    },
  };
}

export function saepPlugin(cluster: SakCluster = 'devnet', opts?: SaepPluginOptions): Action[] {
  return [
    saepRegisterAgentAction(cluster, opts),
    saepListTasksAction(cluster, opts),
    saepCheckReputationAction(cluster, opts),
    saepBidAction(cluster, opts),
    saepRevealBidAction(cluster, opts),
    saepSubmitResultAction(cluster, opts),
    saepWithdrawAction(cluster, opts),
  ];
}
