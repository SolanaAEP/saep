import { cookies } from 'next/headers';
import { SignJWT } from 'jose';
import {
  SESSION_ISSUER,
  sessionSecret,
  verifySessionJwt,
  type SessionPayload,
} from '@saep/sdk';

const COOKIE = 'saep_session';

function secret(): Uint8Array {
  return sessionSecret(process.env.SESSION_SECRET);
}

export type { SessionPayload };

export async function signSession(address: string, ttlSeconds: number): Promise<{
  token: string;
  issuedAt: number;
  expiresAt: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SESSION_ISSUER)
    .setSubject(address)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());
  return { token, issuedAt: now, expiresAt: exp };
}

export async function createSession(address: string, ttlSeconds = 24 * 60 * 60) {
  const { token, issuedAt, expiresAt } = await signSession(address, ttlSeconds);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttlSeconds,
  });
  return { address, issuedAt, expiresAt };
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionJwt(token, secret());
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
