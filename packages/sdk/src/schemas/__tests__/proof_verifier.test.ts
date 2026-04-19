import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  GlobalModeSchema,
  RegisterVkArgsSchema,
  VerifierConfigSchema,
  VerifierKeySchema,
  VerifyProofArgsSchema,
} from '../proof_verifier.js';

const pk = () => PublicKey.default;
const bytes = (n: number) => Array.from({ length: n }, (_, i) => i % 256);
const g1 = () => bytes(64);
const g2 = () => bytes(128);

describe('VerifierConfigSchema', () => {
  const valid = {
    authority: pk(),
    pendingAuthority: null,
    activeVk: pk(),
    pendingVk: null,
    pendingActivatesAt: new BN(0),
    paused: false,
    bump: 254,
  };

  it('parses well-formed config', () => {
    expect(VerifierConfigSchema.parse(valid)).toEqual(valid);
  });

  it('accepts non-null pending fields', () => {
    expect(() =>
      VerifierConfigSchema.parse({
        ...valid,
        pendingAuthority: pk(),
        pendingVk: pk(),
        pendingActivatesAt: new BN(1700000000),
      }),
    ).not.toThrow();
  });
});

describe('VerifierKeySchema', () => {
  const valid = {
    vkId: bytes(32),
    alphaG1: g1(),
    betaG2: g2(),
    gammaG2: g2(),
    deltaG2: g2(),
    ic: [g1(), g1(), g1()],
    numPublicInputs: 2,
    circuitLabel: bytes(32),
    isProduction: false,
    registeredAt: new BN(1700000000),
    registeredBy: pk(),
    bump: 254,
  };

  it('parses well-formed verifier key', () => {
    expect(VerifierKeySchema.parse(valid).ic).toHaveLength(3);
  });

  it('accepts an empty ic array', () => {
    expect(() => VerifierKeySchema.parse({ ...valid, ic: [] })).not.toThrow();
  });

  it('rejects ic entry with wrong G1 length', () => {
    expect(() => VerifierKeySchema.parse({ ...valid, ic: [bytes(63)] })).toThrow();
  });

  it('rejects alphaG1 with wrong length', () => {
    expect(() => VerifierKeySchema.parse({ ...valid, alphaG1: bytes(63) })).toThrow();
  });
});

describe('GlobalModeSchema', () => {
  it('parses well-formed mode', () => {
    expect(GlobalModeSchema.parse({ isMainnet: true, bump: 250 })).toEqual({
      isMainnet: true,
      bump: 250,
    });
  });

  it('rejects non-boolean isMainnet', () => {
    expect(() => GlobalModeSchema.parse({ isMainnet: 'true', bump: 250 })).toThrow();
  });
});

describe('RegisterVkArgsSchema', () => {
  it('parses well-formed args', () => {
    const out = RegisterVkArgsSchema.parse({
      vkId: bytes(32),
      alphaG1: g1(),
      betaG2: g2(),
      gammaG2: g2(),
      deltaG2: g2(),
      ic: [g1(), g1()],
      numPublicInputs: 1,
      circuitLabel: bytes(32),
      isProduction: false,
    });
    expect(out.numPublicInputs).toBe(1);
  });

  it('rejects vkId of wrong length', () => {
    expect(() =>
      RegisterVkArgsSchema.parse({
        vkId: bytes(31),
        alphaG1: g1(),
        betaG2: g2(),
        gammaG2: g2(),
        deltaG2: g2(),
        ic: [],
        numPublicInputs: 0,
        circuitLabel: bytes(32),
        isProduction: false,
      }),
    ).toThrow();
  });
});

describe('VerifyProofArgsSchema', () => {
  it('parses with arbitrary publicInputs length', () => {
    const out = VerifyProofArgsSchema.parse({
      proofA: g1(),
      proofB: g2(),
      proofC: g1(),
      publicInputs: [bytes(32), bytes(32), bytes(32)],
    });
    expect(out.publicInputs).toHaveLength(3);
  });

  it('rejects publicInputs entry of wrong length', () => {
    expect(() =>
      VerifyProofArgsSchema.parse({
        proofA: g1(),
        proofB: g2(),
        proofC: g1(),
        publicInputs: [bytes(31)],
      }),
    ).toThrow();
  });

  it('rejects proofB with wrong length', () => {
    expect(() =>
      VerifyProofArgsSchema.parse({
        proofA: g1(),
        proofB: g1(),
        proofC: g1(),
        publicInputs: [],
      }),
    ).toThrow();
  });
});
