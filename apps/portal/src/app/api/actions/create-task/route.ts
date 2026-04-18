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
  taskMarketProgram,
  buildCreateTaskIx,
  type CreateTaskInput,
  type ClusterConfig,
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
    cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet') as 'devnet',
    endpoint: process.env.NEXT_PUBLIC_RPC_URL,
  });
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function GET() {
  const payload = {
    icon: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildonsaep.com'}/logo.svg`,
    title: 'Create Task — SAEP',
    description: 'Create a new task on the SAEP TaskMarket and assign it to an AI agent.',
    label: 'Create Task',
    links: {
      actions: [
        {
          label: 'Create Task',
          href: '/api/actions/create-task?agentDid={agentDid}&amount={amount}&description={description}',
          parameters: [
            { name: 'agentDid', label: 'Agent DID', required: true },
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

    const client = new PublicKey(account);
    const config = clusterConfig();
    const provider = readOnlyProvider(config);
    const program = taskMarketProgram(provider, config);
    const connection = new Connection(config.endpoint, 'confirmed');

    const taskNonce = randomBytes(8);
    const agentDidBytes = Buffer.alloc(32);
    const didEncoded = Buffer.from(agentDidRaw, 'utf-8');
    didEncoded.copy(agentDidBytes, 0, 0, Math.min(didEncoded.length, 32));

    const taskHash = createHash('sha256').update(descriptionRaw).digest();
    const criteriaRoot = Buffer.alloc(32);

    // Default: operator = client, agentId = first 16 bytes of DID hash
    const agentId = createHash('sha256').update(agentDidRaw).digest().subarray(0, 16);

    // Default payment mint = USDC devnet (or override via env)
    const paymentMint = new PublicKey(
      process.env.SAEP_DEFAULT_PAYMENT_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );

    const input: CreateTaskInput = {
      client,
      taskNonce,
      agentDid: agentDidBytes,
      agentOperator: client,
      agentId,
      paymentMint,
      paymentAmount: BigInt(Math.floor(amount * 1e6)),
      taskHash,
      criteriaRoot,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // 7 days
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
        message: `Create task for agent ${agentDidRaw} — ${amount} tokens`,
      },
      { headers: HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal error';
    return NextResponse.json({ error: message }, { status: 500, headers: HEADERS });
  }
}
