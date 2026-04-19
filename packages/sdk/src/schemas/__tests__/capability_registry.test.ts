import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  CapabilityTagSchema,
  ProposeTagArgsSchema,
  RegistryConfigSchema,
  RetireTagArgsSchema,
  ValidateMaskArgsSchema,
} from '../capability_registry.js';

const pk = () => PublicKey.default;
const bytes = (n: number) => Array.from({ length: n }, (_, i) => i % 256);

describe('RegistryConfigSchema', () => {
  const valid = {
    authority: pk(),
    approvedMask: new BN(0xff),
    tagCount: 4,
    pendingAuthority: null,
    paused: false,
    bump: 254,
  };

  it('parses a well-formed config', () => {
    expect(RegistryConfigSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a non-null pendingAuthority', () => {
    expect(() => RegistryConfigSchema.parse({ ...valid, pendingAuthority: pk() })).not.toThrow();
  });

  it('rejects authority that is not a PublicKey', () => {
    expect(() => RegistryConfigSchema.parse({ ...valid, authority: 'not-a-pubkey' })).toThrow();
  });

  it('rejects approvedMask that is not a BN', () => {
    expect(() => RegistryConfigSchema.parse({ ...valid, approvedMask: 255 })).toThrow();
  });

  it('rejects missing fields', () => {
    const { bump: _bump, ...missing } = valid;
    expect(() => RegistryConfigSchema.parse(missing)).toThrow();
  });
});

describe('CapabilityTagSchema', () => {
  const valid = {
    bitIndex: 7,
    slug: bytes(32),
    manifestUri: bytes(96),
    addedAt: new BN(1700000000),
    addedBy: pk(),
    retired: false,
    bump: 250,
  };

  it('parses a well-formed tag', () => {
    expect(CapabilityTagSchema.parse(valid)).toEqual(valid);
  });

  it('rejects slug shorter than 32 bytes', () => {
    expect(() => CapabilityTagSchema.parse({ ...valid, slug: bytes(31) })).toThrow();
  });

  it('rejects manifestUri longer than 96 bytes', () => {
    expect(() => CapabilityTagSchema.parse({ ...valid, manifestUri: bytes(97) })).toThrow();
  });
});

describe('ProposeTagArgsSchema', () => {
  it('parses well-formed args', () => {
    const out = ProposeTagArgsSchema.parse({
      bitIndex: 0,
      slug: bytes(32),
      manifestUri: bytes(96),
    });
    expect(out.bitIndex).toBe(0);
  });

  it('rejects manifestUri of wrong length', () => {
    expect(() =>
      ProposeTagArgsSchema.parse({ bitIndex: 0, slug: bytes(32), manifestUri: bytes(64) }),
    ).toThrow();
  });
});

describe('RetireTagArgsSchema', () => {
  it('parses a numeric bitIndex', () => {
    expect(RetireTagArgsSchema.parse({ bitIndex: 12 })).toEqual({ bitIndex: 12 });
  });

  it('rejects a string bitIndex', () => {
    expect(() => RetireTagArgsSchema.parse({ bitIndex: '12' })).toThrow();
  });
});

describe('ValidateMaskArgsSchema', () => {
  it('parses a BN mask', () => {
    const mask = new BN('ffffffff', 16);
    expect(ValidateMaskArgsSchema.parse({ mask })).toEqual({ mask });
  });

  it('rejects a non-BN mask', () => {
    expect(() => ValidateMaskArgsSchema.parse({ mask: 0xff })).toThrow();
  });
});
