export type ComputeBondProvider = 'ionet' | 'akash';

export type ComputeBondStatus =
  | 'reserved'
  | 'locked'
  | 'released'
  | 'slashed'
  | 'cancelled'
  | 'expired';

export interface ComputeBondAttestationPayload {
  agent_did: string;
  provider: ComputeBondProvider;
  lease_id: string;
  gpu_hours: number;
  expires_at: number;
}

export interface ComputeBondRecord extends ComputeBondAttestationPayload {
  attestation_sig: string;
  broker_pubkey: string;
  reserved_price_usd_micro: number;
  slashable_until: number;
  task_id: string | null;
  status: ComputeBondStatus;
  created_at_ms: number;
  updated_at_ms: number;
  status_reason: string | null;
}

export type ComputeBondTransition =
  | { type: 'lock'; task_id: string; now_ms: number }
  | { type: 'release'; task_id: string; now_ms: number }
  | { type: 'slash'; task_id: string; now_ms: number; reason?: string }
  | { type: 'cancel'; now_ms: number }
  | { type: 'expire'; now_ms: number };

export const TERMINAL_COMPUTE_BOND_STATUSES = new Set<ComputeBondStatus>([
  'released',
  'slashed',
  'cancelled',
  'expired',
]);

export function canonicalComputeBondAttestation(
  payload: ComputeBondAttestationPayload,
): Uint8Array {
  const fixed = {
    agent_did: payload.agent_did,
    provider: payload.provider,
    lease_id: payload.lease_id,
    gpu_hours: payload.gpu_hours,
    expires_at: payload.expires_at,
  };
  return new TextEncoder().encode(JSON.stringify(fixed));
}

export function validateComputeBondAttestation(
  payload: ComputeBondAttestationPayload,
): string[] {
  const errors: string[] = [];
  if (payload.agent_did.length < 16) errors.push('agent_did is too short');
  if (payload.lease_id.length === 0) errors.push('lease_id is required');
  if (!Number.isInteger(payload.gpu_hours) || payload.gpu_hours <= 0) {
    errors.push('gpu_hours must be a positive integer');
  }
  if (!Number.isInteger(payload.expires_at) || payload.expires_at <= 0) {
    errors.push('expires_at must be a positive integer');
  }
  return errors;
}

export function validateComputeBondRecord(record: ComputeBondRecord): string[] {
  const errors = validateComputeBondAttestation(record);
  if (record.reserved_price_usd_micro < 0) {
    errors.push('reserved_price_usd_micro must be non-negative');
  }
  if (!Number.isInteger(record.slashable_until) || record.slashable_until < record.expires_at) {
    errors.push('slashable_until must be >= expires_at');
  }
  if (!Number.isInteger(record.created_at_ms) || record.created_at_ms <= 0) {
    errors.push('created_at_ms must be a positive integer');
  }
  if (!Number.isInteger(record.updated_at_ms) || record.updated_at_ms < record.created_at_ms) {
    errors.push('updated_at_ms must be >= created_at_ms');
  }
  if (record.status === 'locked' && !record.task_id) {
    errors.push('locked bonds must carry task_id');
  }
  if (TERMINAL_COMPUTE_BOND_STATUSES.has(record.status) && record.task_id === '') {
    errors.push('task_id cannot be empty');
  }
  return errors;
}

export function validateComputeBondTransition(
  record: ComputeBondRecord,
  transition: ComputeBondTransition,
): string[] {
  const errors: string[] = [];

  switch (transition.type) {
    case 'lock':
      if (record.status === 'locked' && record.task_id === transition.task_id) return errors;
      if (record.status !== 'reserved') {
        errors.push(`bond cannot lock from status ${record.status}`);
      }
      if (record.task_id && record.task_id !== transition.task_id) {
        errors.push('bond is already bound to another task');
      }
      if (transition.now_ms / 1000 >= record.expires_at) {
        errors.push('bond reservation has already expired');
      }
      break;
    case 'release':
      if (record.status === 'released' && record.task_id === transition.task_id) return errors;
      if (record.status !== 'locked') {
        errors.push(`bond cannot release from status ${record.status}`);
      }
      if (record.task_id !== transition.task_id) {
        errors.push('release task_id does not match locked task');
      }
      break;
    case 'slash':
      if (record.status === 'slashed' && record.task_id === transition.task_id) return errors;
      if (record.status !== 'locked') {
        errors.push(`bond cannot slash from status ${record.status}`);
      }
      if (record.task_id !== transition.task_id) {
        errors.push('slash task_id does not match locked task');
      }
      break;
    case 'cancel':
      if (record.status === 'cancelled') return errors;
      if (record.status !== 'reserved') {
        errors.push(`bond cannot cancel from status ${record.status}`);
      }
      break;
    case 'expire':
      if (record.status === 'expired') return errors;
      if (TERMINAL_COMPUTE_BOND_STATUSES.has(record.status)) {
        errors.push(`bond cannot expire from status ${record.status}`);
      }
      if (transition.now_ms / 1000 < record.slashable_until) {
        errors.push('slashable window is still active');
      }
      break;
  }

  return errors;
}

export function transitionComputeBond(
  record: ComputeBondRecord,
  transition: ComputeBondTransition,
): ComputeBondRecord {
  const errors = validateComputeBondTransition(record, transition);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  switch (transition.type) {
    case 'lock':
      return {
        ...record,
        status: 'locked',
        task_id: transition.task_id,
        updated_at_ms: transition.now_ms,
        status_reason: null,
      };
    case 'release':
      return {
        ...record,
        status: 'released',
        updated_at_ms: transition.now_ms,
        status_reason: null,
      };
    case 'slash':
      return {
        ...record,
        status: 'slashed',
        updated_at_ms: transition.now_ms,
        status_reason: transition.reason ?? 'task slashed',
      };
    case 'cancel':
      return {
        ...record,
        status: 'cancelled',
        updated_at_ms: transition.now_ms,
        status_reason: 'agent cancelled reservation',
      };
    case 'expire':
      return {
        ...record,
        status: 'expired',
        updated_at_ms: transition.now_ms,
        status_reason: 'slashable window elapsed',
      };
  }
}
