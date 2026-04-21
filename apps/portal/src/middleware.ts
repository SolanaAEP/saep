import { NextRequest, NextResponse } from 'next/server';

function defaultRpcUrl(cluster: string | undefined): string {
  if (cluster === 'mainnet-beta') {
    return 'https://mainnet.helius-rpc.com/?api-key=b457adfa-182d-449a-bf65-74e809efcd77';
  }
  if (cluster === 'localnet') return 'http://127.0.0.1:8899';
  return 'https://api.devnet.solana.com';
}

function cspHeader(nonce: string): string {
  const globalCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
  const stakingCluster = process.env.NEXT_PUBLIC_STAKING_CLUSTER ?? globalCluster;
  const rpcUrls = Array.from(
    new Set(
      [
        process.env.NEXT_PUBLIC_RPC_URL ?? defaultRpcUrl(globalCluster),
        process.env.NEXT_PUBLIC_STAKING_RPC_URL ?? defaultRpcUrl(stakingCluster),
      ].filter(Boolean),
    ),
  );

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${rpcUrls.join(' ')} https://gateway.pinata.cloud wss:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];

  return directives.join('; ');
}

export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = cspHeader(nonce);

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
