import {
  chainIdToSupportedIntentChain,
  deriveCrossChainState,
  type CrossChainIntentEnvelope,
  type CrossChainProtocol,
  type CrossChainState,
  type SupportedIntentChain,
} from '@saep/sdk';
import type { ValidatedPayment } from './xrpl-listener.js';

const DEFAULT_TIMEOUT_WINDOW_MS = 15 * 60_000;

export interface SettlementContext {
  protocol: CrossChainProtocol;
  sourceChain: SupportedIntentChain;
  assetSymbol: string;
  amountAtomic: string;
  requester: string;
  beneficiaryDid: string;
  createdAtMs: number;
  timeoutAtMs: number;
  metadataHash?: string;
}

export function buildIntentEnvelope(
  intentId: string,
  context: SettlementContext,
): CrossChainIntentEnvelope {
  return {
    intentId,
    protocol: context.protocol,
    sourceChain: context.sourceChain,
    destinationChain: 'solana',
    assetSymbol: context.assetSymbol,
    amountAtomic: context.amountAtomic,
    beneficiaryDid: context.beneficiaryDid,
    requester: context.requester,
    createdAtMs: context.createdAtMs,
    timeoutAtMs: context.timeoutAtMs,
    metadataHash: context.metadataHash,
  };
}

export function workflowStateFor(
  status: 'pending' | 'settled' | 'failed',
  intent: CrossChainIntentEnvelope,
  nowMs: number = Date.now(),
): CrossChainState {
  return deriveCrossChainState({
    nowMs,
    timeoutAtMs: intent.timeoutAtMs,
    settled: status === 'settled',
    failed: status === 'failed',
  });
}

export function xrplSettlementContext(
  payment: ValidatedPayment,
  nowMs: number = Date.now(),
): SettlementContext {
  return {
    protocol: 'xrpl-bridge',
    sourceChain: 'xrpl',
    assetSymbol: 'XRP',
    amountAtomic: payment.drops.toString(),
    requester: payment.sender,
    beneficiaryDid: payment.agentDid,
    createdAtMs: nowMs,
    timeoutAtMs: nowMs + DEFAULT_TIMEOUT_WINDOW_MS,
  };
}

export function wormholeSettlementContext(args: {
  sourceChainId: number;
  amountAtomic: bigint;
  beneficiaryDid: string;
  tokenSymbol: string | null;
  digest: string;
  nowMs?: number;
}): SettlementContext | null {
  const sourceChain = chainIdToSupportedIntentChain(args.sourceChainId);
  if (!sourceChain) return null;
  const nowMs = args.nowMs ?? Date.now();
  return {
    protocol: 'wormhole',
    sourceChain,
    assetSymbol: args.tokenSymbol ?? 'UNKNOWN',
    amountAtomic: args.amountAtomic.toString(),
    requester: `wormhole:chain${args.sourceChainId}`,
    beneficiaryDid: args.beneficiaryDid,
    createdAtMs: nowMs,
    timeoutAtMs: nowMs + DEFAULT_TIMEOUT_WINDOW_MS,
    metadataHash: args.digest,
  };
}
