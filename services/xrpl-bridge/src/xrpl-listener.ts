import { EventEmitter } from 'node:events';
import { Client, type TransactionStream, type Transaction } from 'xrpl';
import { xrplListenerConnected, xrplPaymentsReceived } from './metrics.js';

export interface ValidatedPayment {
  txHash: string;
  sender: string;
  drops: bigint;
  solanaPubkey: string;
  agentDid: string;
  ledgerIndex: number;
}

const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;

export class XrplListener extends EventEmitter {
  private client: Client;
  private bridgeWallet: string;
  private minDrops: bigint;
  private confirmationLedgers: number;
  private reconnectAttempt = 0;
  private stopped = false;

  constructor(opts: {
    wsUrl: string;
    bridgeWallet: string;
    minXrpAmount: number;
    confirmationLedgers: number;
  }) {
    super();
    this.client = new Client(opts.wsUrl);
    this.bridgeWallet = opts.bridgeWallet;
    this.minDrops = BigInt(Math.floor(opts.minXrpAmount * 1_000_000));
    this.confirmationLedgers = opts.confirmationLedgers;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
    xrplListenerConnected.set(0);
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.reconnectAttempt = 0;
      xrplListenerConnected.set(1);

      this.client.on('disconnected', () => {
        xrplListenerConnected.set(0);
        if (!this.stopped) this.scheduleReconnect();
      });

      this.client.on('error', (err) => {
        this.emit('error', err);
      });

      await this.client.request({
        command: 'subscribe',
        accounts: [this.bridgeWallet],
      });

      this.client.on('transaction', (evt: TransactionStream) => {
        this.handleTransaction(evt);
      });

      this.emit('connected');
    } catch (err) {
      xrplListenerConnected.set(0);
      this.emit('error', err);
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;
    setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private handleTransaction(evt: TransactionStream): void {
    // xrpl v4 default API (v2) uses tx_json; v1 uses transaction
    const tx = (evt.tx_json ?? (evt as any).transaction) as (Transaction & { hash?: string }) | undefined;
    if (!tx) return;
    if (tx.TransactionType !== 'Payment') return;
    if (!('Destination' in tx)) return;
    if (tx.Destination !== this.bridgeWallet) return;
    if (typeof tx.Amount !== 'string') return;

    const drops = BigInt(tx.Amount);
    if (drops < this.minDrops) return;

    const parsed = parseMemos(tx.Memos);
    if (!parsed) return;

    if (!evt.validated) return;

    xrplPaymentsReceived.inc();

    const payment: ValidatedPayment = {
      txHash: evt.hash ?? tx.hash ?? '',
      sender: tx.Account,
      drops,
      solanaPubkey: parsed.solanaPubkey,
      agentDid: parsed.agentDid,
      ledgerIndex: evt.ledger_index ?? 0,
    };

    this.emit('payment', payment);
  }
}

interface ParsedMemos {
  solanaPubkey: string;
  agentDid: string;
}

export function parseMemos(
  memos: Array<{ Memo: { MemoType?: string; MemoData?: string } }> | undefined,
): ParsedMemos | null {
  if (!memos || memos.length < 2) return null;

  let solanaPubkey: string | undefined;
  let agentDid: string | undefined;

  for (const { Memo } of memos) {
    const memoType = hexToUtf8(Memo.MemoType ?? '');
    const memoData = hexToUtf8(Memo.MemoData ?? '');

    if (memoType === 'solana/pubkey') solanaPubkey = memoData;
    else if (memoType === 'saep/agent-did') agentDid = memoData;
  }

  if (!solanaPubkey || !agentDid) return null;
  if (solanaPubkey.length < 32 || solanaPubkey.length > 44) return null;
  if (agentDid.length < 32 || agentDid.length > 64) return null;

  return { solanaPubkey, agentDid };
}

function hexToUtf8(hex: string): string {
  if (!hex) return '';
  return Buffer.from(hex, 'hex').toString('utf8');
}
