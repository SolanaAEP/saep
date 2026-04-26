import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { AnchorProvider, type Wallet } from '@coral-xyz/anchor';
import {
  resolveCluster,
  agentRegistryProgram,
  taskMarketProgram,
  buildCreateTaskIx,
  fetchAgentByDid,
  marketGlobalPda,
  type CreateTaskInput,
  type ClusterConfig,
  type SaepCluster,
} from '@saep/sdk';
import { createHash, randomBytes } from 'crypto';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Content-Type': 'application/json',
} as const;

function clusterConfig(): ClusterConfig {
  return resolveCluster({
    cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet') as SaepCluster,
    endpoint: process.env.NEXT_PUBLIC_RPC_URL,
  });
}

function isMainnetCluster(config: ClusterConfig): boolean {
  return config.cluster === 'mainnet-beta';
}

function readOnlyProvider(config: ClusterConfig) {
  const kp = Keypair.generate();
  const wallet: Wallet = {
    payer: kp,
    publicKey: kp.publicKey,
    signTransaction: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]) => txs,
  };
  return new AnchorProvider(
    new Connection(config.endpoint, 'confirmed'),
    wallet,
    { commitment: 'confirmed' },
  );
}

function normalizeDidHex(raw: string): string | null {
  const value = raw.startsWith('0x') ? raw.slice(2) : raw;
  return /^[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

function firstCapabilityBit(mask: bigint): number {
  for (let bit = 0; bit < 128; bit += 1) {
    if ((mask & (1n << BigInt(bit))) !== 0n) return bit;
  }
  throw new Error('agent has no enabled capability bits');
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function GET() {
  const payload = {
    icon: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildonsaep.com'}/logo.svg`,
    title: 'Create Task — SAEP',
    description:
      'Create a devnet task on SAEP TaskMarket by on-chain DID hex. Mainnet uses wallet-signed Quick Hire create+fund in the portal.',
    label: 'Create Task',
    links: {
      actions: [
        {
          label: 'Create Task',
          href: '/api/actions/create-task?agentDid={agentDid}&amount={amount}&description={description}',
          parameters: [
            { name: 'agentDid', label: 'Agent DID (64-char hex)', required: true },
            { name: 'amount', label: 'Payment amount (token units)', required: true },
            { name: 'description', label: 'Task description', required: true },
          ],
        },
      ],
    },
  };

  return NextResponse.json(payload, { headers: HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const account: string | undefined = body.account;
    if (!account) {
      return NextResponse.json({ error: 'missing account' }, { status: 400, headers: HEADERS });
    }

    const config = clusterConfig();
    if (isMainnetCluster(config)) {
      return NextResponse.json(
        {
          error:
            'create-task action is devnet-only until it returns atomic create+fund transactions; use portal Quick Hire for mainnet',
        },
        { status: 400, headers: HEADERS },
      );
    }

    const { searchParams } = req.nextUrl;
    const agentDidRaw = searchParams.get('agentDid');
    const amountRaw = searchParams.get('amount');
    const descriptionRaw = searchParams.get('description');

    if (!agentDidRaw || !amountRaw || !descriptionRaw) {
      return NextResponse.json(
        { error: 'missing required parameters: agentDid, amount, description' },
        { status: 400, headers: HEADERS },
      );
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400, headers: HEADERS });
    }

    const taskDescription = descriptionRaw.trim();
    if (!taskDescription) {
      return NextResponse.json(
        { error: 'description must not be empty' },
        { status: 400, headers: HEADERS },
      );
    }

    const client = new PublicKey(account);
    const agentDidHex = normalizeDidHex(agentDidRaw);
    if (!agentDidHex) {
      return NextResponse.json(
        { error: 'agentDid must be a 64-character hex string' },
        { status: 400, headers: HEADERS },
      );
    }

    const provider = readOnlyProvider(config);
    const registry = agentRegistryProgram(provider, config);
    const program = taskMarketProgram(provider, config);
    const connection = new Connection(config.endpoint, 'confirmed');
    const [marketGlobalAddress] = marketGlobalPda(program.programId);
    const marketGlobal = await program.account.marketGlobal.fetchNullable(marketGlobalAddress);

    const agent = await fetchAgentByDid(registry, agentDidHex);
    if (!agent) {
      return NextResponse.json(
        { error: `agent not found for DID ${agentDidHex}` },
        { status: 404, headers: HEADERS },
      );
    }
    if (agent.status !== 'active') {
      return NextResponse.json({ error: 'agent is not active' }, { status: 400, headers: HEADERS });
    }

    const configuredPaymentMint = process.env.SAEP_DEFAULT_PAYMENT_MINT?.trim();
    const paymentMint = configuredPaymentMint
      ? new PublicKey(configuredPaymentMint)
      : marketGlobal?.allowedPaymentMints.find((mint) => !mint.equals(PublicKey.default));
    if (!paymentMint) {
      return NextResponse.json(
        { error: 'task market has no allowed payment mint configured' },
        { status: 503, headers: HEADERS },
      );
    }

    const capabilityBit = firstCapabilityBit(agent.capabilityMask);
    const taskNonce = randomBytes(8);
    const argsHash = new Uint8Array(createHash('sha256').update(taskDescription).digest());
    const criteriaRoot = Buffer.alloc(32);
    const criteria = new TextEncoder().encode(taskDescription);

    const input: CreateTaskInput = {
      client,
      taskNonce,
      agentDid: agent.did,
      agentOperator: agent.operator,
      agentId: agent.agentId,
      paymentMint,
      paymentAmount: BigInt(Math.floor(amount * 1e6)),
      payload: {
        kind: {
          generic: {
            capabilityBit,
            argsHash,
          },
        },
        capabilityBit,
        criteria,
        requiresPersonhood: { none: {} },
      },
      criteriaRoot,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
      milestoneCount: 1,
    };

    const ix: TransactionInstruction = await buildCreateTaskIx(program, config, input);

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = client;
    tx.add(ix);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return NextResponse.json(
      {
        transaction: serialized.toString('base64'),
        message: `Create task for agent ${agentDidHex} — ${amount} tokens`,
      },
      { headers: HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal error';
    return NextResponse.json({ error: message }, { status: 500, headers: HEADERS });
  }
}
