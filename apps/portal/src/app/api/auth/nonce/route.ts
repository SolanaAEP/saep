import { NextRequest, NextResponse } from 'next/server';
import type { SiwsMessage } from '@saep/sdk';
import { issueNonce, signNonceToken } from '@/lib/nonce';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  if (!body?.address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const host = new URL(origin).host;
  const claims = await issueNonce(body.address);
  const nonceToken = await signNonceToken(claims);

  const message: SiwsMessage = {
    domain: host,
    address: body.address,
    statement: 'Sign in to SAEP portal.',
    uri: origin,
    version: '1',
    chainId: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet',
    nonce: claims.nonce,
    issuedAt: claims.issuedAt,
    expirationTime: claims.expirationTime,
  };

  const res = NextResponse.json({ message, nonceToken });
  res.cookies.set('saep_nonce', nonceToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 5 * 60,
  });
  return res;
}
