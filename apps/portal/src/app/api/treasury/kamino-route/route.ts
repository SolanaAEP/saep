import { NextRequest, NextResponse } from 'next/server';

const ROUTE_BUILDER_URL =
  process.env.SAEP_KAMINO_ROUTE_BUILDER_URL?.trim() || process.env.KAMINO_ROUTE_BUILDER_URL?.trim() || '';

const ACTIONS = new Set(['deposit', 'withdraw', 'emergency_unwind']);

function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && new RegExp(`^(0x)?[0-9a-fA-F]{${bytes * 2}}$`).test(value);
}

function isBase58Like(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function normalizeRoutePayload(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new Error('route builder returned a non-object payload');
  const payload = raw as {
    routeDataHex?: unknown;
    routeData?: unknown;
    routeAccounts?: unknown;
  };
  const routeDataHex = payload.routeDataHex ?? payload.routeData;
  if (typeof routeDataHex !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(routeDataHex)) {
    throw new Error('route builder response must include hex routeDataHex');
  }
  if (!Array.isArray(payload.routeAccounts)) {
    throw new Error('route builder response must include routeAccounts array');
  }
  return {
    routeDataHex: routeDataHex.replace(/^0x/, ''),
    routeAccounts: payload.routeAccounts,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'action must be deposit, withdraw, or emergency_unwind' }, { status: 400 });
    }
    if (!isHex(body.agentDidHex, 32) || !isHex(body.strategyIdHex, 32)) {
      return NextResponse.json({ error: 'agentDidHex and strategyIdHex must be 32-byte hex strings' }, { status: 400 });
    }
    for (const key of ['underlyingMint', 'receiptMint', 'strategyProgram']) {
      if (!isBase58Like(body[key])) {
        return NextResponse.json({ error: `${key} must be a valid base58 public key string` }, { status: 400 });
      }
    }
    if (action !== 'emergency_unwind') {
      const amount = String(body.amountRaw ?? '');
      if (!/^[1-9][0-9]*$/.test(amount)) {
        return NextResponse.json({ error: 'amountRaw must be a positive integer string' }, { status: 400 });
      }
    }

    if (!ROUTE_BUILDER_URL) {
      return NextResponse.json(
        {
          error: 'Kamino route builder is not configured',
          code: 'route_builder_missing',
          guidance:
            'Set SAEP_KAMINO_ROUTE_BUILDER_URL on the portal service to enable one-click route preparation, or paste route data manually for devnet/operator verification.',
        },
        { status: 501 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const upstream = await fetch(ROUTE_BUILDER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        return NextResponse.json(
          {
            error: 'Kamino route builder rejected the request',
            status: upstream.status,
            details: json,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(normalizeRoutePayload(json));
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
