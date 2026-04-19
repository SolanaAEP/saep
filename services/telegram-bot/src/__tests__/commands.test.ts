import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { handleStart, handleRegister, handleHire, handleStatus } from '../commands.js';
import type { BotContext } from '../context.js';

function fakeCtx(): BotContext {
  return {
    connection: {} as never,
    config: {} as never,
    agentRegistry: {
      account: {
        agentAccount: {
          all: async () => [],
        },
      },
    } as never,
    taskMarket: {
      account: {
        taskContract: {
          all: async () => [],
          fetchNullable: async () => null,
        },
      },
    } as never,
    portalUrl: 'https://buildonsaep.com',
  };
}

describe('telegram bot commands', () => {
  it('start returns help text with commands', () => {
    const text = handleStart(fakeCtx());
    expect(text).toContain('/agents');
    expect(text).toContain('/hire');
    expect(text).toContain('/status');
    expect(text).toContain('/portfolio');
    expect(text).toContain('/register');
    expect(text).toContain('SAEP Bot');
  });

  it('register returns portal link + blink link', () => {
    const text = handleRegister(fakeCtx());
    expect(text).toContain('https://buildonsaep.com/register');
    expect(text).toContain('/api/actions/register-agent');
  });

  it('hire returns error for unknown capability', async () => {
    const text = await handleHire(fakeCtx(), 'FlyToMoon');
    expect(text).toContain('Unknown capability');
    expect(text).toContain('Swap');
  });

  it('hire returns no agents when registry empty', async () => {
    const text = await handleHire(fakeCtx(), 'Swap');
    expect(text).toContain('No agents found');
  });

  it('status returns not found for nonexistent task', async () => {
    const ctx = fakeCtx();
    const text = await handleStatus(ctx, '11111111111111111111111111111111');
    expect(text).toContain('not found');
  });

  it('hire finds agents with matching capability', async () => {
    const ctx = fakeCtx();
    const agentKp = Keypair.generate();
    ctx.agentRegistry = {
      account: {
        agentAccount: {
          all: async () => [{
            publicKey: agentKp.publicKey,
            account: {
              operator: agentKp.publicKey,
              agentId: new Array(32).fill(0),
              did: new Array(32).fill(0),
              capabilityMask: { toString: () => '1' },
              priceLamports: { toString: () => '0' },
              jobsCompleted: { toString: () => '0' },
            },
          }],
        },
      },
    } as never;
    const text = await handleHire(ctx, 'Swap');
    expect(text).toContain('Swap');
    expect(text).toContain('Hire');
  });
});
