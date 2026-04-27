import { describe, expect, it, beforeEach } from 'vitest';
import { enforceGuardrails, resetVelocityWindow } from '../guardrails.js';

describe('guardrails', () => {
  beforeEach(() => {
    resetVelocityWindow();
  });

  it('passes when under value cap', () => {
    expect(() => enforceGuardrails({ maxAutoSignLamports: 1000 }, 999)).not.toThrow();
  });

  it('rejects when over value cap', () => {
    expect(() => enforceGuardrails({ maxAutoSignLamports: 1000 }, 1001)).toThrow('exceeds cap');
  });

  it('uses default cap when not specified', () => {
    expect(() => enforceGuardrails(undefined, 999_999)).not.toThrow();
    resetVelocityWindow();
    expect(() => enforceGuardrails(undefined, 1_000_001)).toThrow('exceeds cap');
  });

  it('passes value check when valueLamports is undefined', () => {
    expect(() => enforceGuardrails({ maxAutoSignLamports: 0 })).not.toThrow();
  });

  it('enforces velocity limit', () => {
    const opts = { velocityLimit: 3 };
    enforceGuardrails(opts);
    enforceGuardrails(opts);
    enforceGuardrails(opts);
    expect(() => enforceGuardrails(opts)).toThrow('velocity limit exceeded');
  });

  it('resetVelocityWindow clears tracking', () => {
    const opts = { velocityLimit: 1 };
    enforceGuardrails(opts);
    expect(() => enforceGuardrails(opts)).toThrow();
    resetVelocityWindow();
    expect(() => enforceGuardrails(opts)).not.toThrow();
  });
});
