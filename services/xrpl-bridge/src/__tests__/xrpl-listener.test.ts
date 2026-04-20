import { describe, expect, it } from 'vitest';
import { parseMemos } from '../xrpl-listener.js';

function utf8ToHex(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex');
}

describe('xrpl-listener', () => {
  describe('parseMemos', () => {
    it('returns null for undefined memos', () => {
      expect(parseMemos(undefined)).toBeNull();
    });

    it('returns null for empty memos', () => {
      expect(parseMemos([])).toBeNull();
    });

    it('returns null for single memo', () => {
      expect(parseMemos([{
        Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex('A'.repeat(44)) },
      }])).toBeNull();
    });

    it('parses valid solana pubkey + agent DID memos', () => {
      const pubkey = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      const did = 'a'.repeat(32);
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex(pubkey) } },
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex(did) } },
      ]);
      expect(result).toEqual({ solanaPubkey: pubkey, agentDid: did });
    });

    it('handles memos in any order', () => {
      const pubkey = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      const did = 'b'.repeat(40);
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex(did) } },
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex(pubkey) } },
      ]);
      expect(result).toEqual({ solanaPubkey: pubkey, agentDid: did });
    });

    it('rejects pubkey shorter than 32 chars', () => {
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex('short') } },
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex('a'.repeat(32)) } },
      ]);
      expect(result).toBeNull();
    });

    it('rejects pubkey longer than 44 chars', () => {
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex('A'.repeat(50)) } },
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex('a'.repeat(32)) } },
      ]);
      expect(result).toBeNull();
    });

    it('rejects agent DID shorter than 32 chars', () => {
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex('A'.repeat(44)) } },
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex('short') } },
      ]);
      expect(result).toBeNull();
    });

    it('ignores extra unrelated memos', () => {
      const pubkey = 'A'.repeat(44);
      const did = 'c'.repeat(32);
      const result = parseMemos([
        { Memo: { MemoType: utf8ToHex('some/other'), MemoData: utf8ToHex('irrelevant') } },
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex(pubkey) } },
        { Memo: { MemoType: utf8ToHex('saep/agent-did'), MemoData: utf8ToHex(did) } },
      ]);
      expect(result).toEqual({ solanaPubkey: pubkey, agentDid: did });
    });

    it('handles empty MemoType gracefully', () => {
      const result = parseMemos([
        { Memo: { MemoType: '', MemoData: utf8ToHex('data') } },
        { Memo: { MemoType: utf8ToHex('solana/pubkey'), MemoData: utf8ToHex('A'.repeat(44)) } },
      ]);
      expect(result).toBeNull();
    });
  });
});
