import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WebhookStateSnapshot } from './webhooks.js';

const EMPTY_STATE: WebhookStateSnapshot = {
  subscriptions: [],
  deliveries: [],
  events: [],
};

export class JsonFileWebhookStore {
  constructor(private readonly path: string) {}

  load(): WebhookStateSnapshot {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WebhookStateSnapshot>;
      return {
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_STATE;
      }
      throw err;
    }
  }

  save(snapshot: WebhookStateSnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp`;
    writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
    renameSync(tempPath, this.path);
  }
}
