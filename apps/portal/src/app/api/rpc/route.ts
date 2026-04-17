import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

const hits = new Map<string, { count: number; reset: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + WINDOW_MS };
    hits.set(ip, entry);
  }
  entry.count++;
  return entry.count > MAX_REQUESTS;
}

export async function POST(req: NextRequest) {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'RPC not configured' } },
      { status: 503 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? '127.0.0.1';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32005, message: 'Rate limit exceeded' } },
      { status: 429 },
    );
  }

  const body = await req.text();

  const upstream = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await upstream.text();

  return new NextResponse(data, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
