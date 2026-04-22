export type CrossChainProtocol = 'layerzero-intent' | 'cctp' | 'xrpl-bridge' | 'wormhole';

export type CrossChainState =
  | 'awaiting_funds'
  | 'attesting'
  | 'ready_to_fund_task'
  | 'task_funded'
  | 'settled'
  | 'refunded'
  | 'expired'
  | 'failed';

export type CrossChainTrackLifecycle = 'live' | 'prototype' | 'research';

export type SupportedIntentChain =
  | 'solana'
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'xrpl'
  | 'bsc';

export interface CrossChainIntentEnvelope {
  intentId: string;
  protocol: CrossChainProtocol;
  sourceChain: SupportedIntentChain;
  destinationChain: 'solana';
  assetSymbol: string;
  amountAtomic: string;
  beneficiaryDid: string;
  requester: string;
  createdAtMs: number;
  timeoutAtMs: number;
  metadataHash?: string;
}

export interface CrossChainTrack {
  id: string;
  label: string;
  protocol: CrossChainProtocol;
  lifecycle: CrossChainTrackLifecycle;
  supportedSources: readonly SupportedIntentChain[];
  summary: string;
}

export const RESEARCH_CROSS_CHAIN_TRACKS: readonly CrossChainTrack[] = [
  {
    id: 'x402-cctp-funding',
    label: 'x402 + CCTP Funding',
    protocol: 'cctp',
    lifecycle: 'live',
    supportedSources: ['ethereum', 'arbitrum', 'base'],
    summary:
      'Current live path for routing externally funded payments into SAEP settlement surfaces.',
  },
  {
    id: 'xrpl-bridge',
    label: 'XRPL Bridge',
    protocol: 'xrpl-bridge',
    lifecycle: 'prototype',
    supportedSources: ['xrpl'],
    summary:
      'Prototype bridge for XRP-denominated payments into Solana-side SAEP settlement.',
  },
  {
    id: 'layerzero-intents',
    label: 'LayerZero Intents',
    protocol: 'layerzero-intent',
    lifecycle: 'research',
    supportedSources: ['ethereum', 'arbitrum', 'base'],
    summary:
      'Default research track for portable task funding and deterministic timeout/refund handling.',
  },
] as const;

export function chainIdToSupportedIntentChain(chainId: number): SupportedIntentChain | null {
  switch (chainId) {
    case 1:
      return 'solana';
    case 2:
      return 'ethereum';
    case 4:
      return 'bsc';
    default:
      return null;
  }
}

export function validateCrossChainIntent(
  intent: CrossChainIntentEnvelope,
  supportedChains: readonly SupportedIntentChain[] = ['ethereum', 'arbitrum', 'base', 'xrpl'],
): string[] {
  const errors: string[] = [];
  if (intent.destinationChain !== 'solana') {
    errors.push('destinationChain must be solana');
  }
  if (!supportedChains.includes(intent.sourceChain)) {
    errors.push(`unsupported source chain: ${intent.sourceChain}`);
  }
  if (intent.timeoutAtMs <= intent.createdAtMs) {
    errors.push('timeoutAtMs must be after createdAtMs');
  }
  if (!/^\d+$/.test(intent.amountAtomic)) {
    errors.push('amountAtomic must be an integer string');
  }
  if (intent.beneficiaryDid.length < 16) {
    errors.push('beneficiaryDid is too short');
  }
  return errors;
}

export function deriveCrossChainState(input: {
  nowMs: number;
  timeoutAtMs: number;
  attested?: boolean;
  taskFunded?: boolean;
  settled?: boolean;
  refunded?: boolean;
  failed?: boolean;
}): CrossChainState {
  if (input.failed) return 'failed';
  if (input.settled) return 'settled';
  if (input.refunded) return 'refunded';
  if (input.nowMs >= input.timeoutAtMs) return 'expired';
  if (input.taskFunded) return 'task_funded';
  if (input.attested) return 'ready_to_fund_task';
  if (input.nowMs > 0) return 'attesting';
  return 'awaiting_funds';
}
