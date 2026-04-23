'use client';

import type { SerializedAgent } from '@/lib/agent-serializer';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from '../dashboard/capability-tags';

export function fmtSol(lamports: string): string {
  return `${(Number(lamports) / 1e9).toFixed(2)}`;
}

export function avgReputationScore(agent: SerializedAgent): number {
  const r = agent.reputation;
  return (r.quality + r.timeliness + r.availability + r.costEfficiency + r.honesty + r.volume) / 6;
}

export function compositeScore(agent: SerializedAgent): number {
  const avgRep = avgReputationScore(agent);
  const price = Number(agent.priceLamports);
  const priceNorm = price > 0 ? Math.max(0, 1 - price / 10e9) : 0;
  return avgRep * 0.7 + priceNorm * 10000 * 0.3;
}

function humanizeSlug(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

export function agentTitle(agent: SerializedAgent): string {
  const manifest = sanitize(agent.manifestUri)?.trim();
  if (!manifest) return `${agent.did.slice(0, 16)}…`;
  try {
    const url = new URL(manifest);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) return humanizeSlug(last);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return humanizeSlug(manifest);
  }
}

export function agentSubtitle(agent: SerializedAgent): string {
  const manifest = sanitize(agent.manifestUri)?.trim();
  if (!manifest) return `${agent.address.slice(0, 6)}…${agent.address.slice(-4)}`;
  try {
    const url = new URL(manifest);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return manifest;
  }
}

export function agentSearchIndex(agent: SerializedAgent): string {
  const parts = [
    agentTitle(agent),
    agentSubtitle(agent),
    agent.did,
    agent.address,
    ...maskToTags(BigInt(agent.capabilityMask)),
  ];
  return parts.join(' ').toLowerCase();
}
