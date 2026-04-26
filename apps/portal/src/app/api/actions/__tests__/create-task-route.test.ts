import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../create-task/route';

describe('create-task action route', () => {
  it('documents the on-chain DID hex requirement', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.description).toContain('on-chain DID hex');
    expect(body.links.actions[0].parameters[0].label).toBe('Agent DID (64-char hex)');
  });

  it('rejects non-hex agent DID input before building a transaction', async () => {
    const req = new NextRequest(
      'https://buildonsaep.com/api/actions/create-task?agentDid=did:saep:test&amount=1&description=hello',
      {
        method: 'POST',
        body: JSON.stringify({
          account: '11111111111111111111111111111111',
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'agentDid must be a 64-character hex string',
    });
  });

  it('keeps the create-only action route disabled on mainnet', async () => {
    const previousCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = 'mainnet-beta';

    try {
      const req = new NextRequest(
        `https://buildonsaep.com/api/actions/create-task?agentDid=${'a'.repeat(64)}&amount=1&description=hello`,
        {
          method: 'POST',
          body: JSON.stringify({
            account: '11111111111111111111111111111111',
          }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('devnet-only');
      expect(body.error).toContain('Agent Hire');
    } finally {
      if (previousCluster === undefined) {
        delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
      } else {
        process.env.NEXT_PUBLIC_SOLANA_CLUSTER = previousCluster;
      }
    }
  });
});
