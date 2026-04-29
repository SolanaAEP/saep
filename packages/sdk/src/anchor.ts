import BNDefault from 'bn.js';
import {
  Program as AnchorProgramValue,
} from '@coral-xyz/anchor';
import type { Idl, Program as AnchorProgram } from '@coral-xyz/anchor';

// `BN` is imported directly from `bn.js` because the browser bundle's
// `export { default as BN } from 'bn.js'` line poisons the entire module
// under strict Node ESM resolution — when the `default-as-named` re-export
// can't resolve, ALL named imports from that file fail. `Program` and the
// other anchor exports come from the main entry, which Node ESM handles
// cleanly.

export const BN = BNDefault;

export const Program = AnchorProgramValue;
export type Program<T extends Idl = Idl> = AnchorProgram<T>;

export type BN = InstanceType<typeof BNDefault>;
