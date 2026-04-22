import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  transitionComputeBond,
  type ComputeBondProvider,
  type ComputeBondRecord,
  type ComputeBondStatus,
  type ComputeBondTransition,
} from '@saep/sdk';

export interface ComputeBondStateSnapshot {
  bonds: ComputeBondRecord[];
}

const EMPTY_STATE: ComputeBondStateSnapshot = {
  bonds: [],
};

export class JsonFileComputeBondStore {
  constructor(private readonly path: string) {}

  load(): ComputeBondStateSnapshot {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ComputeBondStateSnapshot>;
      return {
        bonds: Array.isArray(parsed.bonds) ? parsed.bonds : [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_STATE;
      }
      throw err;
    }
  }

  save(snapshot: ComputeBondStateSnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp`;
    writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
    renameSync(tempPath, this.path);
  }
}

export class ComputeBondRegistry {
  private readonly bonds = new Map<string, ComputeBondRecord>();

  constructor(private readonly store?: JsonFileComputeBondStore) {
    const snapshot = this.store?.load() ?? EMPTY_STATE;
    for (const bond of snapshot.bonds) {
      this.bonds.set(bond.lease_id, bond);
    }
  }

  get(leaseId: string): ComputeBondRecord | undefined {
    return this.bonds.get(leaseId);
  }

  list(filters: {
    agentDid?: string;
    taskId?: string;
    taskIds?: readonly string[];
    status?: ComputeBondStatus;
    provider?: ComputeBondProvider;
    limit?: number;
  } = {}): ComputeBondRecord[] {
    const taskIds = filters.taskIds ? new Set(filters.taskIds) : null;
    const limit = filters.limit ?? 50;
    return [...this.bonds.values()]
      .filter((bond) => {
        if (filters.agentDid && bond.agent_did !== filters.agentDid) return false;
        if (filters.taskId && bond.task_id !== filters.taskId) return false;
        if (taskIds && (!bond.task_id || !taskIds.has(bond.task_id))) return false;
        if (filters.status && bond.status !== filters.status) return false;
        if (filters.provider && bond.provider !== filters.provider) return false;
        return true;
      })
      .sort((a, b) => b.updated_at_ms - a.updated_at_ms || a.lease_id.localeCompare(b.lease_id))
      .slice(0, limit);
  }

  reserve(record: ComputeBondRecord): ComputeBondRecord {
    const existing = this.bonds.get(record.lease_id);
    if (existing) return existing;
    this.bonds.set(record.lease_id, record);
    this.persist();
    return record;
  }

  replace(record: ComputeBondRecord): void {
    this.bonds.set(record.lease_id, record);
    this.persist();
  }

  transition(leaseId: string, transition: ComputeBondTransition): ComputeBondRecord {
    const current = this.bonds.get(leaseId);
    if (!current) throw new Error('bond not found');
    const next = transitionComputeBond(current, transition);
    this.bonds.set(leaseId, next);
    this.persist();
    return next;
  }

  snapshot(): ComputeBondStateSnapshot {
    return {
      bonds: [...this.bonds.values()].sort((a, b) => a.created_at_ms - b.created_at_ms),
    };
  }

  private persist(): void {
    this.store?.save(this.snapshot());
  }
}
