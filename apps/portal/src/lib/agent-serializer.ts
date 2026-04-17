import type { AgentDetail, ReputationDims, TaskSummary } from '@saep/sdk';

/**
 * JSON-safe mirror of AgentDetail for RSC -> client prop passing.
 * PublicKey -> base58 string, Uint8Array -> hex string, bigint -> string.
 */
export interface SerializedAgent {
  address: string;
  operator: string;
  agentId: string;
  did: string;
  manifestUri: string;
  capabilityMask: string;
  priceLamports: string;
  streamRate: string;
  stakeAmount: string;
  status: string;
  jobsCompleted: string;
  registeredAt: number;
  reputation: ReputationDims;
  jobsDisputed: number;
  version: number;
  lastActive: number;
  delegate: string | null;
}

export interface SerializedTask {
  address: string;
  taskId: string;
  client: string;
  agentDid: string;
  taskNonce: string;
  paymentMint: string;
  paymentAmount: string;
  status: string;
  deadline: number;
  verified: boolean;
  createdAt: number;
}

function hexFromBytes(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function serializeAgent(a: AgentDetail): SerializedAgent {
  return {
    address: a.address.toBase58(),
    operator: a.operator.toBase58(),
    agentId: hexFromBytes(a.agentId),
    did: hexFromBytes(a.did),
    manifestUri: a.manifestUri,
    capabilityMask: a.capabilityMask.toString(),
    priceLamports: a.priceLamports.toString(),
    streamRate: a.streamRate.toString(),
    stakeAmount: a.stakeAmount.toString(),
    status: a.status,
    jobsCompleted: a.jobsCompleted.toString(),
    registeredAt: a.registeredAt,
    reputation: a.reputation,
    jobsDisputed: a.jobsDisputed,
    version: a.version,
    lastActive: a.lastActive,
    delegate: a.delegate?.toBase58() ?? null,
  };
}

export function serializeTask(t: TaskSummary): SerializedTask {
  return {
    address: t.address.toBase58(),
    taskId: hexFromBytes(t.taskId),
    client: t.client.toBase58(),
    agentDid: hexFromBytes(t.agentDid),
    taskNonce: hexFromBytes(t.taskNonce),
    paymentMint: t.paymentMint.toBase58(),
    paymentAmount: t.paymentAmount.toString(),
    status: t.status,
    deadline: t.deadline,
    verified: t.verified,
    createdAt: t.createdAt,
  };
}
