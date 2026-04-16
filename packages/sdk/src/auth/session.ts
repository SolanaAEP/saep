import { jwtVerify } from 'jose';

export const SESSION_ISSUER = 'saep.portal';

export interface SessionPayload {
  address: string;
  issuedAt: number;
  expiresAt: number;
}

export function sessionSecret(raw: string | undefined): Uint8Array {
  if (!raw) throw new Error('SESSION_SECRET is required');
  return new TextEncoder().encode(raw);
}

export async function verifySessionJwt(
  token: string,
  secret: Uint8Array,
  opts: { issuer?: string } = {},
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: opts.issuer ?? SESSION_ISSUER,
    });
    const address = payload.sub;
    const iat = payload.iat;
    const exp = payload.exp;
    if (typeof address !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') {
      return null;
    }
    return { address, issuedAt: iat, expiresAt: exp };
  } catch {
    return null;
  }
}
