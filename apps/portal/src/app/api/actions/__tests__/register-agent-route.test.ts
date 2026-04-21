import { describe, expect, it } from 'vitest';
import { GET } from '../register-agent/route';

describe('register-agent action route', () => {
  it('documents the optional stake amount override', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.description).toContain('defaults to the current minimum stake');
    expect(body.links.actions[0].href).toContain('stakeAmount={stakeAmount}');
    expect(body.links.actions[0].parameters[3]).toEqual({
      name: 'stakeAmount',
      label: 'Stake amount (defaults to registry minimum)',
      required: false,
    });
  });
});
