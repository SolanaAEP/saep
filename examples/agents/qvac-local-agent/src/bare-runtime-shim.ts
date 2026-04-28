// QVAC v0.9.1 spawns a Bare subprocess via `bare-runtime/index.js`, which calls
// `require('bare-runtime-{platform}-{arch}')` and expects it to expose a `.bare`
// field pointing to the executable. The platform package's index.js loads that
// via `require-asset`, which is a Bare-only dependency that pnpm refuses to
// install on Node (engines: { bare: '>=1.10.0' }), so the `require` chain
// throws "No binaries found" before any model is loaded.
//
// We sidestep the broken chain by registering a fake CJS module under the
// expected platform-package name that exports the binary path directly. Must
// be imported before any @qvac/sdk module.

import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const platformKey = `bare-runtime-${process.platform}-${process.arch}`;

const cjsRequire = createRequire(import.meta.url);

function findBinary(): string | null {
  // bare-runtime is hidden behind pnpm strict isolation, but @qvac/sdk is a
  // direct dep of this package and bare-runtime is a sibling in the SDK's
  // own .pnpm-managed node_modules/. Bridge through the SDK to reach it.
  let sdkPkg: string;
  try {
    sdkPkg = cjsRequire.resolve('@qvac/sdk/package');
  } catch {
    return null;
  }
  const sdkRequire = createRequire(sdkPkg);
  let bareRuntimeIndex: string;
  try {
    bareRuntimeIndex = sdkRequire.resolve('bare-runtime');
  } catch {
    return null;
  }
  // realpath dereferences pnpm's symlink. Walk one level up to node_modules/...
  const realBareRuntime = realpathSync(dirname(bareRuntimeIndex));
  const candidate = resolve(realBareRuntime, '..', platformKey, 'bin', 'bare');
  return existsSync(candidate) ? candidate : null;
}

const binaryPath = findBinary();

if (binaryPath) {
  const Module = cjsRequire('node:module') as typeof import('node:module') & {
    _cache: Record<string, unknown>;
    _resolveFilename: (req: string, parent: unknown, ...rest: unknown[]) => string;
  };

  const fakePath = `<qvac-shim>/${platformKey}/index.js`;
  Module._cache[fakePath] = {
    id: fakePath,
    filename: fakePath,
    loaded: true,
    exports: { bare: binaryPath },
    children: [],
    paths: [],
  };

  const origResolve = Module._resolveFilename.bind(Module);
  Module._resolveFilename = function patched(request: string, parent: unknown, ...rest: unknown[]) {
    if (request === platformKey) return fakePath;
    return origResolve(request, parent, ...rest);
  };
}

export const SHIM_BINARY_PATH = binaryPath;
