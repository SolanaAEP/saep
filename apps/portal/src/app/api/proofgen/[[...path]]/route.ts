import { NextRequest, NextResponse } from 'next/server';
import { readSession, signSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROOFGEN_AUDIENCE = 'saep:proof-gen';
const PROOFGEN_TOKEN_TTL_SECONDS = 5 * 60;

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

function proofGenBaseUrl(): string | null {
  const configured =
    process.env.PROOFGEN_API_URL
    ?? process.env.PROOF_GEN_API_URL
    ?? process.env.PROOFGEN_URL
    ?? null;
  if (configured) return configured.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:8787';
}

function upstreamUrl(path: string[]): URL | null {
  const base = proofGenBaseUrl();
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.join('/')}`.replace(/\/+/g, '/');
  return url;
}

async function proofGenBearer(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;
  const { token } = await signSession(session.address, PROOFGEN_TOKEN_TTL_SECONDS, {
    audience: PROOFGEN_AUDIENCE,
  });
  return token;
}

async function proxyJson(
  req: NextRequest,
  path: string[],
  opts: { requireSession: boolean; proofBearer?: boolean } = { requireSession: true },
): Promise<NextResponse> {
  const url = upstreamUrl(path);
  if (!url) {
    return NextResponse.json({ error: 'proofgen_not_configured' }, { status: 503 });
  }
  url.search = req.nextUrl.search;

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('accept', 'application/json');

  if (opts.requireSession || opts.proofBearer) {
    const token = await proofGenBearer();
    if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (opts.proofBearer) headers.set('authorization', `Bearer ${token}`);
  }

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
      redirect: 'manual',
    });
    const body = await upstream.text();
    const responseHeaders = new Headers();
    responseHeaders.set('content-type', upstream.headers.get('content-type') ?? 'application/json');
    responseHeaders.set('x-saep-proofgen-proxy', '1');
    return new NextResponse(body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'proofgen_upstream_unavailable',
        detail: error instanceof Error ? error.message : 'unknown proof-gen proxy failure',
      },
      { status: 503 },
    );
  }
}

async function handle(req: NextRequest, ctx: RouteContext) {
  const { path = [] } = await ctx.params;
  const [resource, id] = path;

  if (req.method === 'GET' && path.length === 1 && (resource === 'healthz' || resource === 'circuits')) {
    return proxyJson(req, path, { requireSession: true });
  }

  if (req.method === 'POST' && path.length === 1 && resource === 'prove') {
    return proxyJson(req, path, { requireSession: true, proofBearer: true });
  }

  if (req.method === 'GET' && path.length === 2 && resource === 'jobs') {
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
    }
    return proxyJson(req, path, { requireSession: true });
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
