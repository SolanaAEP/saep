import { NextRequest, NextResponse } from 'next/server';
import { type PublicServiceKey, getPublicServiceKeys } from '@/lib/public-service-routes';
import { proxyPublicServiceRequest } from '@/lib/service-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    service: string;
    path?: string[];
  }>;
};

function isServiceKey(value: string): value is PublicServiceKey {
  return getPublicServiceKeys().includes(value as PublicServiceKey);
}

async function handle(req: NextRequest, ctx: RouteContext) {
  const { service, path = [] } = await ctx.params;
  if (!isServiceKey(service)) {
    return NextResponse.json({ error: 'unknown_service' }, { status: 404 });
  }
  return proxyPublicServiceRequest(req, service, path);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

export async function OPTIONS(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
