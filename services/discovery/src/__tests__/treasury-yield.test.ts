import { describe, expect, it } from 'vitest';
import { buildServer, type DiscoveryDb } from '../server.js';

function createDb(overrides: {
  query?: (text: string, values?: unknown[]) => Promise<unknown[]>;
  queryOne?: (text: string, values?: unknown[]) => Promise<unknown | null>;
}) {
  const db: DiscoveryDb = {
    getPool: () =>
      ({
        query: async () => ({ rows: [{ ok: 1 }] }),
      }) as never,
    query: async <T>(text: string, values?: unknown[]) =>
      ((await overrides.query?.(text, values)) ?? []) as T[],
    queryOne: async <T>(text: string, values?: unknown[]) =>
      (((await overrides.queryOne?.(text, values)) ?? null) as T | null),
    close: async () => {},
  };
  return db;
}

describe('discovery treasury yield visibility', () => {
  it('lists strategy positions from persisted yield movement snapshots', async () => {
    const did = 'aa'.repeat(32);
    const strategy = 'bb'.repeat(32);
    const db = createDb({
      async query(text: string) {
        if (text.includes('FROM treasury_yield_position_directory')) {
          return [
            {
              agent_did: Buffer.from(did, 'hex'),
              strategy_id: Buffer.from(strategy, 'hex'),
              vault_mint: 'USDC11111111111111111111111111111111111',
              receipt_mint: 'kUSDC1111111111111111111111111111111111',
              principal_amount: '1000000',
              receipt_amount: '999000',
              realized_yield_amount: '2500',
              deployed_amount: '1000000',
              idle_amount: '9000000',
              accounting_slot: '123',
              status: 'active',
              unwind_requested: false,
              last_event_name: 'YieldStrategyDeposit',
              updated_unix: '1700000300',
            },
          ];
        }
        return [];
      },
    });
    const app = await buildServer({ installSignalHandlers: false, db });

    const res = await app.inject({
      method: 'GET',
      url: `/treasury/${did}/yield/positions`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      did_hex: did,
      items: [
        {
          strategy_id_hex: strategy,
          principal_amount: '1000000',
          receipt_amount: '999000',
          status: 'active',
        },
      ],
    });

    await app.close();
  });
});
