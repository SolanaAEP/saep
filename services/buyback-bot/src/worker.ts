import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createBurnInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
import type { Logger } from 'pino';
import {
  feeAccumulatorBalance,
  lastQuoteSaepOutput,
  lastQuotePriceImpactBps,
  swapAttemptsTotal,
  burnAttemptsTotal,
  tickDuration,
  tickSkippedTotal,
  tickFailuresTotal,
} from './metrics.js';
import {
  getJupiterQuote,
  getJupiterSwap,
  isWithinSlippageCap,
  priceImpactPctToBps,
} from './jupiter.js';
import type { Config } from './config.js';

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export interface WorkerDeps {
  connection: Connection;
  config: Config;
  log: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface TickResult {
  feeBalanceUsdcBase: bigint;
  swapped: boolean;
  reason?: string;
  quotedSaepOutBase?: bigint;
  quotedPriceImpactBps?: number;
}

async function readUsdcBalance(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const info = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
  return BigInt(info.value.amount);
}

export async function runTick(deps: WorkerDeps): Promise<TickResult> {
  const { connection, config, log } = deps;
  const stop = tickDuration.startTimer();
  try {
    if (!config.feeAccumulatorAccount) {
      tickSkippedTotal.inc({ reason: 'fee_account_unset' });
      log.warn(
        'BUYBACK_FEE_ACCUMULATOR_ACCOUNT is not set — bot needs the fee-collector token account address to read the USDC balance. Resolve from MarketGlobal.fee_collector once and provide it as an env.',
      );
      return { feeBalanceUsdcBase: 0n, swapped: false, reason: 'fee_account_unset' };
    }

    let feeAccount: PublicKey;
    try {
      feeAccount = new PublicKey(config.feeAccumulatorAccount);
    } catch {
      tickFailuresTotal.inc({ stage: 'parse_fee_account' });
      throw new Error(`invalid BUYBACK_FEE_ACCUMULATOR_ACCOUNT: ${config.feeAccumulatorAccount}`);
    }

    let balance: bigint;
    try {
      balance = await readUsdcBalance(connection, feeAccount);
    } catch (err) {
      tickFailuresTotal.inc({ stage: 'read_balance' });
      log.error(
        { err: err instanceof Error ? err.message : String(err), feeAccount: feeAccount.toBase58() },
        'tick:read-balance-failed',
      );
      throw err;
    }
    feeAccumulatorBalance.set(Number(balance));
    log.info(
      { feeAccount: feeAccount.toBase58(), usdcBase: balance.toString() },
      'tick:fee-balance',
    );

    if (balance < BigInt(config.swapThresholdUsdc)) {
      tickSkippedTotal.inc({ reason: 'below_threshold' });
      return {
        feeBalanceUsdcBase: balance,
        swapped: false,
        reason: 'below_threshold',
      };
    }

    let quote;
    try {
      quote = await getJupiterQuote({
        apiUrl: config.jupiterApiUrl,
        inputMint: config.usdcMint,
        outputMint: config.saepMint,
        amount: balance,
        slippageBps: config.slippageBps,
        fetchImpl: deps.fetchImpl,
      });
    } catch (err) {
      tickFailuresTotal.inc({ stage: 'jupiter_quote' });
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'tick:quote-failed');
      throw err;
    }

    const outBase = BigInt(quote.outAmount);
    const impactBps = priceImpactPctToBps(quote.priceImpactPct);
    lastQuoteSaepOutput.set(Number(outBase));
    lastQuotePriceImpactBps.set(impactBps);
    log.info(
      {
        usdcInBase: balance.toString(),
        saepOutBase: outBase.toString(),
        priceImpactBps: impactBps,
      },
      'tick:quote',
    );

    if (!isWithinSlippageCap(quote, config.slippageBps)) {
      tickSkippedTotal.inc({ reason: 'slippage_above_cap' });
      return {
        feeBalanceUsdcBase: balance,
        swapped: false,
        reason: 'slippage_above_cap',
        quotedSaepOutBase: outBase,
        quotedPriceImpactBps: impactBps,
      };
    }

    if (config.mode !== 'active') {
      tickSkippedTotal.inc({ reason: 'observe_mode' });
      return {
        feeBalanceUsdcBase: balance,
        swapped: false,
        reason: 'observe_mode',
        quotedSaepOutBase: outBase,
        quotedPriceImpactBps: impactBps,
      };
    }

    if (!config.operatorKeypairPath) {
      tickFailuresTotal.inc({ stage: 'missing_keypair' });
      throw new Error('active mode requires OPERATOR_KEYPAIR_PATH');
    }

    const cranker = loadKeypair(config.operatorKeypairPath);
    const saepMint = new PublicKey(config.saepMint);

    let saepReceived: bigint;
    try {
      const swapRes = await getJupiterSwap({
        apiUrl: config.jupiterApiUrl,
        quoteResponse: quote,
        userPublicKey: cranker.publicKey.toBase58(),
        fetchImpl: deps.fetchImpl,
      });

      const txBuf = Buffer.from(swapRes.swapTransaction, 'base64');
      const vTx = VersionedTransaction.deserialize(txBuf);
      vTx.sign([cranker]);

      const ata = getAssociatedTokenAddressSync(saepMint, cranker.publicKey, false, TOKEN_2022);
      const preBal = await connection.getTokenAccountBalance(ata, 'confirmed')
        .then((r) => BigInt(r.value.amount))
        .catch(() => 0n);

      const sig = await connection.sendRawTransaction(vTx.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });
      await connection.confirmTransaction(
        { signature: sig, lastValidBlockHeight: swapRes.lastValidBlockHeight, blockhash: vTx.message.recentBlockhash },
        'confirmed',
      );

      const postBal = BigInt(
        (await connection.getTokenAccountBalance(ata, 'confirmed')).value.amount,
      );
      saepReceived = postBal - preBal;

      swapAttemptsTotal.inc({ outcome: 'success' });
      log.info(
        { sig, saepReceived: saepReceived.toString(), usdcSpent: balance.toString() },
        'swap:success',
      );
    } catch (err) {
      swapAttemptsTotal.inc({ outcome: 'error' });
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'swap:failed');
      throw err;
    }

    if (saepReceived <= 0n) {
      log.warn('swap returned zero SAEP, skipping burn');
      return {
        feeBalanceUsdcBase: balance,
        swapped: true,
        reason: 'zero_saep_received',
        quotedSaepOutBase: outBase,
        quotedPriceImpactBps: impactBps,
      };
    }

    try {
      const ata = getAssociatedTokenAddressSync(saepMint, cranker.publicKey, false, TOKEN_2022);
      const burnIx = createBurnInstruction(ata, saepMint, cranker.publicKey, saepReceived, [], TOKEN_2022);
      const tx = new Transaction().add(burnIx);
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = cranker.publicKey;
      tx.sign(cranker);

      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, 'confirmed');

      burnAttemptsTotal.inc({ outcome: 'success' });
      log.info({ sig, burned: saepReceived.toString() }, 'burn:success');
    } catch (err) {
      burnAttemptsTotal.inc({ outcome: 'error' });
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'burn:failed');
      throw err;
    }

    return {
      feeBalanceUsdcBase: balance,
      swapped: true,
      quotedSaepOutBase: outBase,
      quotedPriceImpactBps: impactBps,
    };
  } finally {
    stop();
  }
}

export interface Worker {
  start: () => void;
  stop: () => Promise<void>;
}

export function startWorker(deps: WorkerDeps): Worker {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTick(deps);
    } catch (err) {
      deps.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'tick:failed',
      );
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.config.pollIntervalMs);
      void tick();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
