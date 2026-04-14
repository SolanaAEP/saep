import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';

describe('saep bootstrap', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it('connects to localnet', async () => {
    const version = await provider.connection.getVersion();
    expect(version).to.have.property('solana-core');
  });
});
