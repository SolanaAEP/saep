import { PriceServiceConnection } from '@pythnetwork/price-service-client';
import { priceOracleAge } from './metrics.js';

// pyth price feed IDs (mainnet)
const XRP_USD_FEED = 'ec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8';
const SOL_USD_FEED = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

const CACHE_TTL_MS = 30_000;
const MAX_STALENESS_MS = 60_000;

interface CachedPrice {
  price: number;
  confidence: number;
  fetchedAt: number;
  publishTime: number;
}

let xrpUsd: CachedPrice | null = null;
let solUsd: CachedPrice | null = null;
let connection: PriceServiceConnection | null = null;

export function initOracle(endpoint: string): void {
  connection = new PriceServiceConnection(endpoint, { priceFeedRequestConfig: { binary: false } });
}

async function fetchPrice(feedId: string): Promise<CachedPrice> {
  if (!connection) throw new Error('oracle not initialized');

  const feeds = await connection.getLatestPriceFeeds([feedId]);
  if (!feeds || feeds.length === 0) throw new Error(`no price feed for ${feedId}`);

  const feed = feeds[0]!;
  const current = feed.getPriceNoOlderThan(60);
  if (!current) throw new Error(`price too stale for feed ${feedId}`);

  const price = Number(current.price) * Math.pow(10, current.expo);
  const confidence = Number(current.conf) * Math.pow(10, current.expo);

  return {
    price,
    confidence,
    fetchedAt: Date.now(),
    publishTime: current.publishTime * 1000,
  };
}

function isFresh(cached: CachedPrice | null): cached is CachedPrice {
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

function assertNotStale(cached: CachedPrice, label: string): void {
  const age = Date.now() - cached.publishTime;
  if (age > MAX_STALENESS_MS) {
    throw new Error(`${label} price stale: ${Math.round(age / 1000)}s old`);
  }
}

export async function getXrpUsd(): Promise<CachedPrice> {
  if (!isFresh(xrpUsd)) {
    xrpUsd = await fetchPrice(XRP_USD_FEED);
  }
  assertNotStale(xrpUsd, 'XRP/USD');
  priceOracleAge.set({ pair: 'XRP/USD' }, (Date.now() - xrpUsd.publishTime) / 1000);
  return xrpUsd;
}

export async function getSolUsd(): Promise<CachedPrice> {
  if (!isFresh(solUsd)) {
    solUsd = await fetchPrice(SOL_USD_FEED);
  }
  assertNotStale(solUsd, 'SOL/USD');
  priceOracleAge.set({ pair: 'SOL/USD' }, (Date.now() - solUsd.publishTime) / 1000);
  return solUsd;
}

export async function getXrpToSolRate(): Promise<{ rate: number; xrpUsd: number; solUsd: number }> {
  const [xrp, sol] = await Promise.all([getXrpUsd(), getSolUsd()]);
  return {
    rate: xrp.price / sol.price,
    xrpUsd: xrp.price,
    solUsd: sol.price,
  };
}

export async function convertXrpToLamports(xrpDrops: bigint): Promise<bigint> {
  const { rate } = await getXrpToSolRate();
  const xrpAmount = Number(xrpDrops) / 1_000_000;
  const solAmount = xrpAmount * rate;
  return BigInt(Math.floor(solAmount * 1_000_000_000));
}

export function _resetCache(): void {
  xrpUsd = null;
  solUsd = null;
}
