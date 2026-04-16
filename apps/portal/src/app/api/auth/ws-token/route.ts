import { NextResponse } from 'next/server';
import { readSession, signSession } from '@/lib/session';

export const runtime = 'nodejs';

const WS_TOKEN_TTL_SECONDS = 5 * 60;

export async function POST() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { token, expiresAt } = await signSession(session.address, WS_TOKEN_TTL_SECONDS);
  return NextResponse.json({
    token,
    address: session.address,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
}
