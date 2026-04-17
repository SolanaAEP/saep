import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    console.error('pg pool error', err.message);
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<T[]> {
  const { rows } = await getPool().query<T>(text, values);
  return rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
