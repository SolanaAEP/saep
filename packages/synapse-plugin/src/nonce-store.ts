import type { NonceEntry, NonceStore } from './types.js';

export class MemoryNonceStore implements NonceStore {
  private entries = new Map<string, NonceEntry>();

  async save(entry: NonceEntry): Promise<void> {
    this.entries.set(entry.taskAddress, entry);
  }

  async get(taskAddress: string): Promise<NonceEntry | null> {
    return this.entries.get(taskAddress) ?? null;
  }

  async delete(taskAddress: string): Promise<void> {
    this.entries.delete(taskAddress);
  }

  async list(): Promise<NonceEntry[]> {
    return [...this.entries.values()];
  }
}
