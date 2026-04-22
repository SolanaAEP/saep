import { BN, Program as BrowserProgram } from '@coral-xyz/anchor/dist/browser/index.js';
import type { Idl, Program as AnchorProgram } from '@coral-xyz/anchor';

// Use Anchor's browser bundle so client builds avoid Node-only dependencies
// like fs, while Node 22 ESM can still load the module consistently.
export { BN };

export const Program = BrowserProgram as typeof import('@coral-xyz/anchor').Program;
export type Program<T extends Idl = Idl> = AnchorProgram<T>;

export type BN = InstanceType<typeof BN>;
