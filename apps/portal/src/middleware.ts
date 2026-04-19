import { NextRequest, NextResponse } from 'next/server';

function cspHeader(nonce: string): string {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? '';

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${rpcUrl} https://gateway.pinata.cloud wss:`,
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
