import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { CapabilityRegistry } from '../target/types/capability_registry';

const PROGRAM_ID = new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F');

const M1_TAGS: [number, string][] = [
  [0, 'retrieval_rag'],
  [1, 'retrieval_web'],
  [2, 'code_gen'],
  [3, 'code_review'],
  [4, 'code_exec_sandbox'],
  [5, 'text_summarize'],
  [6, 'text_translate'],
  [7, 'text_classify'],
  [8, 'image_gen'],
  [9, 'image_caption'],
  [10, 'image_ocr'],
  [11, 'audio_transcribe'],
  [12, 'audio_synthesize'],
  [13, 'data_clean'],
  [14, 'data_extract'],
  [15, 'data_label'],
  [16, 'scraping_public'],
  [17, 'moderation_content'],
  [18, 'embedding'],
  [19, 'search_semantic'],
  [20, 'routing'],
  [21, 'pricing'],
  [22, 'negotiation'],
  [23, 'escrow_ops'],
  [24, 'solana_read'],
  [25, 'solana_sign'],
  [26, 'defi_quote'],
  [27, 'defi_execute'],
  [28, 'oracle_read'],
  [29, 'nft_mint'],
  [30, 'governance_vote'],
  [31, 'inference_generic'],
];

function padSlug(s: string): number[] {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

function manifestUri(slug: string): number[] {
  const uri = `ipfs://saep-capability-manifest/${slug}`;
  const buf = Buffer.alloc(96, 0);
  Buffer.from(uri, 'utf8').copy(buf);
  return Array.from(buf);
}

function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

function tagPda(bitIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('tag'), Buffer.from([bitIndex])],
    PROGRAM_ID,
  );
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/capability_registry.json');
  const program = new anchor.Program<CapabilityRegistry>(idl, provider);
  const authority = provider.wallet;
  const [config] = configPda();

  let cfg = await program.account.registryConfig.fetch(config).catch(() => null);
  if (!cfg) {
    console.log('initializing registry...');
    await program.methods
      .initialize(authority.publicKey)
      .accountsPartial({ payer: authority.publicKey })
      .rpc({ commitment: 'confirmed' });
    cfg = await program.account.registryConfig.fetch(config);
  }

  console.log(`registry: authority=${cfg.authority}, tags=${cfg.tagCount}, mask=${cfg.approvedMask.toString(16)}`);

  let seeded = 0;
  let skipped = 0;

  for (const [bit, slug] of M1_TAGS) {
    const [tag] = tagPda(bit);
    const exists = await program.account.capabilityTag.fetch(tag).catch(() => null);
    if (exists) {
      skipped++;
      continue;
    }

    await program.methods
      .proposeTag(bit, padSlug(slug), manifestUri(slug))
      .accountsPartial({
        tag,
        authority: authority.publicKey,
        payer: authority.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    seeded++;
    console.log(`  [${bit}] ${slug}`);
  }

  cfg = await program.account.registryConfig.fetch(config);
  const allSet = cfg.approvedMask.eq(new anchor.BN(1).shln(32).sub(new anchor.BN(1)));

  console.log(`\nseeded: ${seeded}, skipped (existing): ${skipped}`);
  console.log(`tag_count: ${cfg.tagCount}`);
  console.log(`approved_mask: 0x${cfg.approvedMask.toString(16)}`);
  console.log(`all 32 bits set: ${allSet}`);

  if (!allSet) {
    console.error('FAIL: not all 32 bits are set in approved_mask');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
