import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';

const ISSUER = 'saep.nonce';

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error('SESSION_SECRET is required');
  return new TextEncoder().encode(raw);
}

export interface NonceClaims {
  nonce: string;
  address: string;
  issuedAt: string;
  expirationTime: string;
}

export async function issueNonce(address: string, ttlSeconds = 5 * 60): Promise<NonceClaims> {
  const now = new Date();
  const exp = new Date(now.getTime() + ttlSeconds * 1000);
  const nonce = randomBytes(16).toString('hex');
  await new SignJWT({ nonce, address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(exp.getTime() / 1000))
    .sign(secret());
  return {
    nonce,
    address,
    issuedAt: now.toISOString(),
    expirationTime: exp.toISOString(),
  };
}

export async function signNonceToken(claims: NonceClaims): Promise<string> {
  const iat = Math.floor(new Date(claims.issuedAt).getTime() / 1000);
  const exp = Math.floor(new Date(claims.expirationTime).getTime() / 1000);
  return new SignJWT({ nonce: claims.nonce, address: claims.address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret());
}

export async function verifyNonceToken(token: string): Promise<NonceClaims> {
  const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
  return {
    nonce: payload.nonce as string,
    address: payload.address as string,
    issuedAt: new Date((payload.iat as number) * 1000).toISOString(),
    expirationTime: new Date((payload.exp as number) * 1000).toISOString(),
  };
}
