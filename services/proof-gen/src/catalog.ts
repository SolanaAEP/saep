import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  DEFAULT_CIRCUIT_CATALOG,
  circuitArtifactStem,
  circuitRuntimeId,
  circuitRuntimeStem,
  validateCircuitCatalogEntry,
  type CircuitCatalogEntry,
} from '@saep/sdk';
import { z } from 'zod';

const CircuitCatalogManifestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  lifecycle: z.enum(['live', 'planned', 'research']),
  version: z.number().int().min(1),
  verifier: z.enum(['groth16-bn254', 'ezkl']),
  verificationKeyVersion: z.number().int().min(1).default(1),
  publicInputs: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
});

export interface RuntimeCircuitCatalogEntry extends CircuitCatalogEntry {
  runtimeId: string;
  manifestPath: string;
  buildDir: string;
  wasmPath: string;
  zkeyPath: string;
  verificationKeyPath: string;
  artifactsReady: boolean;
  verificationKeyPresent: boolean;
}

export interface RuntimeCircuitCatalogOptions {
  catalogDir?: string;
  buildRoot?: string;
}

function defaultCatalogDir(): string {
  return resolve(process.env.CIRCUIT_CATALOG_DIR ?? '../../circuits/catalog');
}

function defaultBuildRoot(): string {
  return resolve(process.env.CIRCUIT_BUILD_ROOT ?? '../../circuits');
}

function readCatalogEntries(catalogDir: string): CircuitCatalogEntry[] {
  if (!existsSync(catalogDir)) {
    return [...DEFAULT_CIRCUIT_CATALOG];
  }

  return readdirSync(catalogDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = JSON.parse(readFileSync(resolve(catalogDir, name), 'utf8'));
      const parsed = CircuitCatalogManifestSchema.parse(raw);
      const entry: CircuitCatalogEntry = {
        slug: parsed.slug,
        displayName: parsed.displayName,
        lifecycle: parsed.lifecycle,
        version: parsed.version,
        verifier: parsed.verifier,
        verificationKeyVersion: parsed.verificationKeyVersion,
        publicInputs: parsed.publicInputs,
        summary: parsed.summary,
      };
      const errors = validateCircuitCatalogEntry(entry);
      if (errors.length > 0) {
        throw new Error(`invalid circuit manifest ${name}: ${errors.join(', ')}`);
      }
      return entry;
    });
}

export function loadRuntimeCircuitCatalog(
  options: RuntimeCircuitCatalogOptions = {},
): RuntimeCircuitCatalogEntry[] {
  const catalogDir = options.catalogDir ?? defaultCatalogDir();
  const buildRoot = options.buildRoot ?? defaultBuildRoot();

  return readCatalogEntries(catalogDir).map((entry) => {
    const runtimeStem = circuitRuntimeStem(entry);
    const buildDir = resolve(buildRoot, runtimeStem, 'build');
    const wasmPath = resolve(buildDir, `${runtimeStem}_js`, `${runtimeStem}.wasm`);
    const zkeyPath = resolve(buildDir, `${runtimeStem}.zkey`);
    const verificationKeyPath = resolve(buildDir, 'verification_key.json');
    const manifestPath = resolve(catalogDir, `${circuitArtifactStem(entry)}.json`);
    return {
      ...entry,
      runtimeId: circuitRuntimeId(entry),
      manifestPath,
      buildDir,
      wasmPath,
      zkeyPath,
      verificationKeyPath,
      artifactsReady: existsSync(wasmPath) && existsSync(zkeyPath),
      verificationKeyPresent: existsSync(verificationKeyPath),
    };
  });
}

export function findRuntimeCircuit(
  catalog: readonly RuntimeCircuitCatalogEntry[],
  runtimeId: string,
): RuntimeCircuitCatalogEntry | undefined {
  return catalog.find((entry) => entry.runtimeId === runtimeId);
}

export function hashCircuitPublicInputs(
  circuit: Pick<RuntimeCircuitCatalogEntry, 'runtimeId' | 'publicInputs'>,
  publicInputs: Record<string, unknown>,
): string {
  const canonical = JSON.stringify([
    circuit.runtimeId,
    ...circuit.publicInputs.map((field) => publicInputs[field]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
