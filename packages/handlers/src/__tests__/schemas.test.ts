import { describe, expect, it } from 'vitest';
import {
  RegisterAgentSchema,
  ListTasksSchema,
  DiscoverTasksSchema,
  GetTaskSchema,
  GetReputationSchema,
  BidSchema,
  RevealBidSchema,
  SubmitResultSchema,
  ClaimPayoutSchema,
  WithdrawEarningsSchema,
} from '../schemas.js';

const VALID_B58 = '11111111111111111111111111111111';
const VALID_HEX32 = 'a'.repeat(64);
const VALID_ATA = '9oRq6WnTcNP7UoLyAdDK3V4EEq8pswYnBsbT7FwXeJE3';

describe('RegisterAgentSchema', () => {
  it('requires capability_bits with at least one entry', () => {
    expect(() => RegisterAgentSchema.parse({ metadata_uri: 'https://x.com', stake_mint: VALID_B58, operator_token_account: VALID_ATA })).toThrow();
    expect(() => RegisterAgentSchema.parse({ capability_bits: [], metadata_uri: 'https://x.com', stake_mint: VALID_B58, operator_token_account: VALID_ATA })).toThrow();
  });

  it('rejects non-url metadata_uri', () => {
    expect(() => RegisterAgentSchema.parse({ capability_bits: [0], metadata_uri: 'not-url', stake_mint: VALID_B58, operator_token_account: VALID_ATA })).toThrow();
  });

  it('defaults stake_amount, price_lamports, stream_rate to "0"', () => {
    const parsed = RegisterAgentSchema.parse({ capability_bits: [0], metadata_uri: 'https://x.com', stake_mint: VALID_B58, operator_token_account: VALID_ATA });
    expect(parsed.stake_amount).toBe('0');
    expect(parsed.price_lamports).toBe('0');
    expect(parsed.stream_rate).toBe('0');
  });
});

describe('ListTasksSchema', () => {
  it('defaults limit to 20', () => {
    expect(ListTasksSchema.parse({}).limit).toBe(20);
  });

  it('rejects non-hex32 agent_did_hex', () => {
    expect(() => ListTasksSchema.parse({ agent_did_hex: 'zz' })).toThrow();
  });
});

describe('DiscoverTasksSchema', () => {
  it('accepts status filter', () => {
    expect(DiscoverTasksSchema.parse({ status: 'open' }).status).toBe('open');
  });

  it('rejects invalid status', () => {
    expect(() => DiscoverTasksSchema.parse({ status: 'invalid' })).toThrow();
  });
});

describe('GetTaskSchema', () => {
  it('requires valid base58 task_address', () => {
    expect(() => GetTaskSchema.parse({ task_address: 'bad!!!' })).toThrow();
    expect(GetTaskSchema.parse({ task_address: VALID_B58 }).task_address).toBe(VALID_B58);
  });
});

describe('GetReputationSchema', () => {
  it('accepts empty input', () => {
    expect(GetReputationSchema.parse({})).toMatchObject({});
  });

  it('validates hex32 did', () => {
    expect(() => GetReputationSchema.parse({ agent_did_hex: 'zz' })).toThrow();
  });
});

describe('BidSchema', () => {
  it('requires all fields', () => {
    expect(() => BidSchema.parse({ task_address: VALID_B58, amount_usdc_micro: 1000 })).toThrow();
  });

  it('rejects non-positive amount', () => {
    expect(() => BidSchema.parse({ task_address: VALID_B58, amount_usdc_micro: 0, agent_did_hex: VALID_HEX32, bidder_token_account: VALID_ATA })).toThrow();
  });

  it('accepts valid input', () => {
    expect(() => BidSchema.parse({ task_address: VALID_B58, amount_usdc_micro: 1000, agent_did_hex: VALID_HEX32, bidder_token_account: VALID_ATA })).not.toThrow();
  });
});

describe('RevealBidSchema', () => {
  it('validates nonce_hex format', () => {
    expect(() => RevealBidSchema.parse({ task_address: VALID_B58, amount_usdc_micro: 1000, nonce_hex: 'xx' })).toThrow();
    expect(() => RevealBidSchema.parse({ task_address: VALID_B58, amount_usdc_micro: 1000, nonce_hex: VALID_HEX32 })).not.toThrow();
  });
});

describe('SubmitResultSchema', () => {
  it('rejects non-hex result_hash', () => {
    expect(() => SubmitResultSchema.parse({ task_address: VALID_B58, result_hash: 'zz', proof_key: VALID_HEX32 })).toThrow();
  });

  it('rejects non-hex proof_key', () => {
    expect(() => SubmitResultSchema.parse({ task_address: VALID_B58, result_hash: VALID_HEX32, proof_key: 'nothex' })).toThrow();
  });
});

describe('ClaimPayoutSchema', () => {
  it('requires task_address, optionals are optional', () => {
    expect(ClaimPayoutSchema.parse({ task_address: VALID_B58 })).toMatchObject({ task_address: VALID_B58 });
  });
});

describe('WithdrawEarningsSchema', () => {
  it('rejects bad stream address', () => {
    expect(() => WithdrawEarningsSchema.parse({ stream_address: 'bad!!!' })).toThrow();
  });

  it('accepts full swap fields', () => {
    expect(() => WithdrawEarningsSchema.parse({
      stream_address: VALID_B58,
      route_data_base64: 'AQID',
      jupiter_program: VALID_B58,
      payer_price_feed: VALID_B58,
      payout_price_feed: VALID_B58,
    })).not.toThrow();
  });
});
