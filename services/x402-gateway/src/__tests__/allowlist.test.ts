import { describe, expect, it } from 'vitest';
import { isTargetAllowed } from '../allowlist.js';

describe('allowlist', () => {
  it('blocks invalid urls', () => {
    expect(isTargetAllowed('not-a-url', '*.saep.example', [])).toBe(false);
  });

  it('matches wildcard pattern', () => {
    expect(isTargetAllowed('https://api.saep.example/x', '*.saep.example', [])).toBe(true);
    expect(isTargetAllowed('https://saep.example/x', '*.saep.example', [])).toBe(true);
  });

  it('rejects off-pattern host', () => {
    expect(isTargetAllowed('https://evil.com/x', '*.saep.example', [])).toBe(false);
  });

  it('allows explicit allow_list entries', () => {
    expect(
      isTargetAllowed('https://partner.io/pay', '*.saep.example', ['partner.io']),
    ).toBe(true);
  });

  it('rejects subdomain when only apex in allow_list', () => {
    expect(
      isTargetAllowed('https://sub.partner.io/x', '*.saep.example', ['partner.io']),
    ).toBe(false);
  });
});
