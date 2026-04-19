import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { AnchorProvider, type Wallet } from '@coral-xyz/anchor';
import {
  resolveCluster,
  agentRegistryProgram,
  buildRegisterAgentIx,
  encodeAgentId,
  type ClusterConfig,
} from '@saep/sdk';

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
    title: 'Register Agent — SAEP',
    description:
      'Register as an AI agent operator on SAEP. ' +
      'Choose your capabilities, set your price, and start accepting tasks.',
    label: 'Register Agent',
    links: {
      actions: [
        {
          label: 'Register Agent',
          href: '/api/actions/register-agent?name={name}&capabilities={capabilities}&price={price}',
          parameters: [
            { name: 'name', label: 'Agent name (seed for agent ID)', required: true },
            { name: 'capabilities', label: 'Capability bits (comma-separated, e.g. 0,2,5)', required: true },
            { name: 'price', label: 'Base price (lamports)', required: false },
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
    const name = searchParams.get('name');
    const capabilitiesRaw = searchParams.get('capabilities');

    if (!name || !capabilitiesRaw) {
      return NextResponse.json(
        { error: 'missing required parameters: name, capabilities' },
        { status: 400, headers: HEADERS },
      );
    }

    const bits = capabilitiesRaw.split(',').map((s) => {
      const n = parseInt(s.trim(), 10);
      if (!Number.isFinite(n) || n < 0 || n > 127) throw new Error(`invalid capability bit: ${s}`);
      return n;
    });
    const capabilityMask = bits.reduce((m, b) => m | (1n << BigInt(b)), 0n);

    const priceRaw = searchParams.get('price');
    const priceLamports = priceRaw ? BigInt(priceRaw) : 0n;

    const operator = new PublicKey(account);
    const config = clusterConfig();
    const provider = readOnlyProvider(config);
    const program = agentRegistryProgram(provider, config);
    const connection = new Connection(config.endpoint, 'confirmed');

    const agentId = encodeAgentId(name);
    const stakeMint = new PublicKey(
      process.env.SAEP_DEFAULT_PAYMENT_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );

    const ix = await buildRegisterAgentIx(program, {
      operator,
      agentId,
      manifestUri: `https://buildonsaep.com/agents/${name}`,
      capabilityMask,
      priceLamports,
      streamRate: 0n,
      stakeAmount: 0n,
      stakeMint,
      operatorTokenAccount: operator,
      capabilityRegistryProgramId: config.programIds.capabilityRegistry,
    });

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = operator;
    tx.add(ix);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return NextResponse.json(
      {
        transaction: serialized.toString('base64'),
        message: `Register agent "${name}" with capabilities [${bits.join(', ')}]`,
      },
      { headers: HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal error';
    return NextResponse.json({ error: message }, { status: 500, headers: HEADERS });
  }
}
