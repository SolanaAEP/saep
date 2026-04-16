import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { TreasuryStandard } from '../target/types/treasury_standard';

const PROGRAM_ID = new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ');

// Hex Trust + LayerZero wrapped XRP on Solana (mint created 2026-01-20).
// As of 2026-04: Solana-side circulating supply ~10.87 wXRP, ~$1 Jupiter liquidity,
// 6 holders, no DEX pools (`isSus: true` in Jupiter metadata). This script is
// DEVNET ONLY — symbolic allowlist to test multi-mint code paths and signal
// readiness for when Solana-side wXRP liquidity matures.
//
// DO NOT run against mainnet until: Jupiter TVL > $1M, >1k holders, and an
// active Raydium/Meteora pool exists.
const WXRP = new PublicKey('6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2');

async function main() {
  const mint = new PublicKey(process.argv[2] ?? WXRP.toBase58());

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const cluster = (provider.connection.rpcEndpoint.match(/devnet|mainnet|localnet|127\.0\.0\.1/) ?? ['unknown'])[0];
  if (cluster === 'mainnet') {
    console.error('refusing to run on mainnet — see header comment');
    process.exit(2);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/treasury_standard.json');
  const program = new anchor.Program<TreasuryStandard>(idl, provider);

  const [allowedMintsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('allowed_mints')],
    PROGRAM_ID,
  );

  const existing = await program.account.allowedMints.fetch(allowedMintsPda);
  const already = (existing.mints as PublicKey[]).some((m) => m.equals(mint));
  if (already) {
    console.log(`already allowlisted on ${cluster}: ${mint.toBase58()}`);
    return;
  }

  console.log(`cluster=${cluster} adding allowed mint: ${mint.toBase58()}`);
  const sig = await program.methods
    .addAllowedMint(mint)
    .accountsPartial({ authority: provider.wallet.publicKey })
    .rpc({ commitment: 'confirmed' });
  console.log(`signature: ${sig}`);

  const after = await program.account.allowedMints.fetch(allowedMintsPda);
  console.log(`mints now (${(after.mints as PublicKey[]).length}):`);
  for (const m of after.mints as PublicKey[]) {
    console.log(`  ${m.toBase58()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
