import { NextRequest, NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { formatSiwsMessage, type SiwsMessage } from '@saep/sdk';
import { verifyNonceToken } from '@/lib/nonce';
import { createSession } from '@/lib/session';

export const runtime = 'nodejs';

interface VerifyBody {
  message: SiwsMessage;
  signature: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as VerifyBody | null;
  if (!body?.message || !body.signature) {
    return NextResponse.json({ error: 'message and signature required' }, { status: 400 });
  }

  const nonceToken = req.cookies.get('saep_nonce')?.value;
  if (!nonceToken) return NextResponse.json({ error: 'nonce expired' }, { status: 401 });

  let claims;
  try {
    claims = await verifyNonceToken(nonceToken);
  } catch {
    return NextResponse.json({ error: 'invalid nonce' }, { status: 401 });
  }

  if (claims.nonce !== body.message.nonce || claims.address !== body.message.address) {
    return NextResponse.json({ error: 'nonce mismatch' }, { status: 401 });
  }

  const now = Date.now();
  if (new Date(body.message.expirationTime).getTime() < now) {
    return NextResponse.json({ error: 'message expired' }, { status: 401 });
  }

  const expectedHost = new URL(req.url).host;
  if (body.message.domain !== expectedHost) {
    return NextResponse.json({ error: 'domain mismatch' }, { status: 401 });
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(body.message.address);
  } catch {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }

  const formatted = formatSiwsMessage(body.message);
  const messageBytes = new TextEncoder().encode(formatted);
  const sigBytes = Buffer.from(body.signature, 'base64');
  const ok = nacl.sign.detached.verify(messageBytes, sigBytes, pubkey.toBytes());
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const session = await createSession(body.message.address);

  const res = NextResponse.json({ session });
  res.cookies.delete('saep_nonce');
  return res;
}
