import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findRuntimeCircuit,
  hashCircuitPublicInputs,
  loadRuntimeCircuitCatalog,
} from '../catalog.js';

const CATALOG_DIR = resolve(import.meta.dirname, '..', '..', '..', '..', 'circuits', 'catalog');
const BUILD_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..', 'circuits');

describe('runtime circuit catalog', () => {
  it('loads task completion metadata from the catalog manifest', () => {
    const catalog = loadRuntimeCircuitCatalog({ catalogDir: CATALOG_DIR, buildRoot: BUILD_ROOT });
    const taskCompletion = findRuntimeCircuit(catalog, 'task_completion.v1');

    expect(taskCompletion).toMatchObject({
      slug: 'task-completion',
      runtimeId: 'task_completion.v1',
      verificationKeyVersion: 1,
      publicInputs: ['task_hash', 'result_hash', 'deadline', 'submitted_at', 'criteria_root'],
    });
    expect(taskCompletion?.manifestPath).toContain('task-completion-v1.json');
  });

  it('hashes public inputs by catalog order, not object insertion order', () => {
    const catalog = loadRuntimeCircuitCatalog({ catalogDir: CATALOG_DIR, buildRoot: BUILD_ROOT });
    const taskCompletion = findRuntimeCircuit(catalog, 'task_completion.v1');
    expect(taskCompletion).toBeDefined();

    const a = hashCircuitPublicInputs(taskCompletion!, {
      submitted_at: '40',
      task_hash: '0x01',
      result_hash: '0x02',
      criteria_root: '0x03',
      deadline: '50',
    });
    const b = hashCircuitPublicInputs(taskCompletion!, {
      task_hash: '0x01',
      result_hash: '0x02',
      deadline: '50',
      submitted_at: '40',
      criteria_root: '0x03',
    });

    expect(a).toBe(b);
  });
});
