import { NextRequest, NextResponse } from 'next/server';
import {
  type PublicServiceKey,
  getPublicServiceManifest,
  getPublicServiceUpstreamUrl,
} from './public-service-routes';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

function joinPath(basePath: string, extraPath: string): string {
  const base = basePath === '/' ? '' : basePath.replace(/\/$/, '');
  const extra = extraPath.replace(/^\/+/, '');
  return extra ? `${base}/${extra}` : (base || '/');
}

function copyRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  return headers;
}

function copyResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  return headers;
}

export async function proxyPublicServiceRequest(
  req: NextRequest,
  service: PublicServiceKey,
  path: string[],
): Promise<NextResponse> {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        Allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      },
    });
  }

  if (path.length === 0) {
    return NextResponse.json(getPublicServiceManifest(service), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const upstreamBase = getPublicServiceUpstreamUrl(service);
  const upstreamUrl = new URL(upstreamBase);
  upstreamUrl.pathname = joinPath(upstreamUrl.pathname, path.join('/'));
  upstreamUrl.search = req.nextUrl.search;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: copyRequestHeaders(req),
      body: BODYLESS_METHODS.has(req.method) ? undefined : await req.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    });

    const headers = copyResponseHeaders(upstream);
    headers.set('x-saep-public-proxy', service);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'upstream_unavailable',
        service,
        upstream_base_url: upstreamBase,
        detail: error instanceof Error ? error.message : 'unknown proxy failure',
      },
      { status: 503 },
    );
  }
}
