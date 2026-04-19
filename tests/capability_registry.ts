import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import { airdrop, fundedKeypair, getProvider } from './helpers/setup';
import { padBytes } from './helpers/encoding';
import { capReg, PROGRAM_IDS } from './helpers/accounts';
import type { CapabilityRegistry } from '../target/types/capability_registry';

type Program = anchor.Program<CapabilityRegistry>;

async function fetchEvents(
  program: Program,
  provider: anchor.AnchorProvider,
  sig: string,
): Promise<Array<{ name: string; data: Record<string, unknown> }>> {
  const tx = await provider.connection.getTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) return [];
  const parser = new anchor.EventParser(program.programId, program.coder);
  const out: Array<{ name: string; data: Record<string, unknown> }> = [];
  for (const ev of parser.parseLogs(tx.meta.logMessages)) {
    out.push({ name: ev.name, data: ev.data as Record<string, unknown> });
  }
  return out;
}

async function expectAnchorError(
  fn: () => Promise<unknown>,
  code: string | RegExp,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = String(e);
    const match = typeof code === 'string' ? msg.includes(code) : code.test(msg);
    if (!match) throw new Error(`expected error matching ${code}, got: ${msg}`);
    return;
  }
  throw new Error(`expected throw matching ${code}, but call resolved`);
}

async function isInitialized(program: Program, pda: PublicKey): Promise<boolean> {
  try {
    await program.account.registryConfig.fetch(pda);
    return true;
  } catch {
    return false;
  }
}

async function hasTag(program: Program, pda: PublicKey): Promise<boolean> {
  try {
    await program.account.capabilityTag.fetch(pda);
    return true;
  } catch {
    return false;
  }
}

describe('capability_registry', () => {
  let provider: anchor.AnchorProvider;
  let program: Program;
  let authority: anchor.Wallet;
  const [configPda] = capReg.config();

  before(() => {
    provider = getProvider();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idl = require('../target/idl/capability_registry.json');
    program = new anchor.Program<CapabilityRegistry>(idl, provider) as Program;
    authority = provider.wallet as anchor.Wallet;
  });

  const slug = (s: string) => padBytes(s, 32) as unknown as number[];
  const uri = (s: string) => padBytes(s, 96) as unknown as number[];

  describe('initialize', () => {
    it('creates registry config with authority, mask=0, paused=false', async () => {
      const already = await isInitialized(program, configPda);
      if (!already) {
        const sig = await program.methods
          .initialize(authority.publicKey)
          .accountsPartial({ payer: authority.publicKey })
          .rpc({ commitment: 'confirmed' });
        const events = await fetchEvents(program, provider, sig);
        const init = events.find((e) => e.name === 'registryInitialized');
        expect(init, 'RegistryInitialized event').to.not.be.undefined;
      }
      const cfg = await program.account.registryConfig.fetch(configPda);
      expect(cfg.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(cfg.paused).to.equal(false);
      expect(cfg.pendingAuthority).to.equal(null);
    });

    it('rejects duplicate init', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .initialize(authority.publicKey)
            .accountsPartial({ payer: authority.publicKey })
            .rpc(),
        /already in use/,
      );
    });
  });

  describe('propose_tag', () => {
    const bit = 3;
    it('happy path sets bit, increments count, emits TagApproved', async () => {
      const [tagPda] = capReg.tag(bit);
      if (!(await hasTag(program, tagPda))) {
        const before = await program.account.registryConfig.fetch(configPda);
        const sig = await program.methods
          .proposeTag(bit, slug('test_cap'), uri('ipfs://cap-manifest'))
          .accountsPartial({
            tag: tagPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
          })
          .rpc({ commitment: 'confirmed' });
        const events = await fetchEvents(program, provider, sig);
        const ev = events.find((e) => e.name === 'tagApproved');
        expect(ev, 'TagApproved event').to.not.be.undefined;
        expect((ev!.data as { bitIndex: number }).bitIndex).to.equal(bit);

        const after = await program.account.registryConfig.fetch(configPda);
        expect(after.tagCount).to.equal(before.tagCount + 1);
        expect(after.approvedMask.testn(bit)).to.equal(true);
      }
      const tag = await program.account.capabilityTag.fetch(tagPda);
      expect(tag.bitIndex).to.equal(bit);
      expect(tag.retired).to.equal(false);
    });

    it('rejects unauthorized signer with Unauthorized', async () => {
      const intruder = await fundedKeypair(provider, 2);
      const [tagPda] = capReg.tag(50);
      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(50, slug('intruder'), uri('ipfs://x'))
            .accountsPartial({
              tag: tagPda,
              authority: intruder.publicKey,
              payer: intruder.publicKey,
            })
            .signers([intruder])
            .rpc(),
        /Unauthorized|has_one/,
      );
    });

    it('rejects bit_index >= 128 with BitIndexOutOfRange', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(200, slug('toohigh'), uri('ipfs://x'))
            .accountsPartial({
              tag: capReg.tag(200)[0],
              authority: authority.publicKey,
              payer: authority.publicKey,
            })
            .rpc(),
        /BitIndexOutOfRange|bit index/,
      );
    });

    it('rejects invalid slug (uppercase)', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(52, slug('BadSlug'), uri('ipfs://x'))
            .accountsPartial({
              tag: capReg.tag(52)[0],
              authority: authority.publicKey,
              payer: authority.publicKey,
            })
            .rpc(),
        /InvalidSlug|slug/,
      );
    });

    it('rejects empty manifest uri', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(53, slug('good_slug'), uri(''))
            .accountsPartial({
              tag: capReg.tag(53)[0],
              authority: authority.publicKey,
              payer: authority.publicKey,
            })
            .rpc(),
        /InvalidManifestUri|manifest/,
      );
    });

    it('rejects duplicate bit (account already in use)', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(3, slug('dup'), uri('ipfs://dup'))
            .accountsPartial({
              tag: capReg.tag(3)[0],
              authority: authority.publicKey,
              payer: authority.publicKey,
            })
            .rpc(),
        /already in use/,
      );
    });
  });

  describe('update_manifest_uri', () => {
    it('rewrites uri and emits TagManifestUpdated', async () => {
      const sig = await program.methods
        .updateManifestUri(3, uri('ipfs://cap-manifest-v2'))
        .accountsPartial({ tag: capReg.tag(3)[0], authority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      const events = await fetchEvents(program, provider, sig);
      expect(events.some((e) => e.name === 'tagManifestUpdated')).to.equal(true);
    });

    it('rejects unauthorized signer', async () => {
      const intruder = await fundedKeypair(provider, 1);
      await expectAnchorError(
        () =>
          program.methods
            .updateManifestUri(3, uri('ipfs://hijack'))
            .accountsPartial({ tag: capReg.tag(3)[0], authority: intruder.publicKey })
            .signers([intruder])
            .rpc(),
        /Unauthorized|has_one/,
      );
    });

    it('rejects empty uri', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .updateManifestUri(3, uri(''))
            .accountsPartial({ tag: capReg.tag(3)[0], authority: authority.publicKey })
            .rpc(),
        /InvalidManifestUri|manifest/,
      );
    });
  });

  describe('set_paused', () => {
    it('toggles and emits PausedSet', async () => {
      const sigOn = await program.methods
        .setPaused(true)
        .accountsPartial({ authority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      const onEvents = await fetchEvents(program, provider, sigOn);
      const onEv = onEvents.find((e) => e.name === 'pausedSet');
      expect(onEv, 'PausedSet(on)').to.not.be.undefined;
      expect((onEv!.data as { paused: boolean }).paused).to.equal(true);
      expect((await program.account.registryConfig.fetch(configPda)).paused).to.equal(true);

      await expectAnchorError(
        () =>
          program.methods
            .proposeTag(60, slug('while_paused'), uri('ipfs://x'))
            .accountsPartial({
              tag: capReg.tag(60)[0],
              authority: authority.publicKey,
              payer: authority.publicKey,
            })
            .rpc(),
        /Paused|paused/,
      );

      await program.methods
        .setPaused(false)
        .accountsPartial({ authority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      expect((await program.account.registryConfig.fetch(configPda)).paused).to.equal(false);
    });

    it('rejects unauthorized signer', async () => {
      const intruder = await fundedKeypair(provider, 1);
      await expectAnchorError(
        () =>
          program.methods
            .setPaused(true)
            .accountsPartial({ authority: intruder.publicKey })
            .signers([intruder])
            .rpc(),
        /Unauthorized|has_one/,
      );
    });
  });

  describe('validate_mask', () => {
    it('accepts approved subset', async () => {
      const cfg = await program.account.registryConfig.fetch(configPda);
      const mask = cfg.approvedMask.and(new anchor.BN(1).shln(3));
      await program.methods.validateMask(mask).accountsPartial({}).rpc();
    });

    it('rejects unapproved bit', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .validateMask(new anchor.BN(1).shln(99))
            .accountsPartial({})
            .rpc(),
        /InvalidCapability|capability/,
      );
    });
  });

  describe('retire_tag', () => {
    it('clears bit, marks retired, emits TagRetired', async () => {
      const [tagPda] = capReg.tag(3);
      const tagBefore = await program.account.capabilityTag.fetch(tagPda);
      if (tagBefore.retired) return;

      const sig = await program.methods
        .retireTag(3)
        .accountsPartial({ tag: tagPda, authority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      const events = await fetchEvents(program, provider, sig);
      expect(events.some((e) => e.name === 'tagRetired')).to.equal(true);

      const cfg = await program.account.registryConfig.fetch(configPda);
      expect(cfg.approvedMask.testn(3)).to.equal(false);
      const tagAfter = await program.account.capabilityTag.fetch(tagPda);
      expect(tagAfter.retired).to.equal(true);
    });

    it('rejects retiring an already-retired tag', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .retireTag(3)
            .accountsPartial({ tag: capReg.tag(3)[0], authority: authority.publicKey })
            .rpc(),
        /TagRetired|retired/,
      );
    });

    it('validate_mask rejects retired bit', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .validateMask(new anchor.BN(1).shln(3))
            .accountsPartial({})
            .rpc(),
        /InvalidCapability|capability/,
      );
    });
  });

  describe('transfer_authority / accept_authority', () => {
    let next: Keypair;

    before(async () => {
      next = await fundedKeypair(provider, 2);
    });

    it('accept without pending rejects with NoPendingAuthority', async () => {
      await expectAnchorError(
        () =>
          program.methods
            .acceptAuthority()
            .accountsPartial({ pendingAuthority: next.publicKey })
            .signers([next])
            .rpc(),
        /NoPendingAuthority|pending/,
      );
    });

    it('propose -> wrong-signer accept rejects, correct-signer accept rotates', async () => {
      const sigT = await program.methods
        .transferAuthority(next.publicKey)
        .accountsPartial({ authority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      const tEvents = await fetchEvents(program, provider, sigT);
      expect(tEvents.some((e) => e.name === 'authorityTransferProposed')).to.equal(true);

      const impostor = await fundedKeypair(provider, 1);
      await expectAnchorError(
        () =>
          program.methods
            .acceptAuthority()
            .accountsPartial({ pendingAuthority: impostor.publicKey })
            .signers([impostor])
            .rpc(),
        /Unauthorized/,
      );

      const sigA = await program.methods
        .acceptAuthority()
        .accountsPartial({ pendingAuthority: next.publicKey })
        .signers([next])
        .rpc({ commitment: 'confirmed' });
      const aEvents = await fetchEvents(program, provider, sigA);
      expect(aEvents.some((e) => e.name === 'authorityTransferAccepted')).to.equal(true);

      const cfg = await program.account.registryConfig.fetch(configPda);
      expect(cfg.authority.toBase58()).to.equal(next.publicKey.toBase58());
      expect(cfg.pendingAuthority).to.equal(null);
    });

    it('rotates authority back to wallet so downstream tests keep working', async () => {
      await program.methods
        .transferAuthority(authority.publicKey)
        .accountsPartial({ authority: next.publicKey })
        .signers([next])
        .rpc({ commitment: 'confirmed' });
      await program.methods
        .acceptAuthority()
        .accountsPartial({ pendingAuthority: authority.publicKey })
        .rpc({ commitment: 'confirmed' });
      const cfg = await program.account.registryConfig.fetch(configPda);
      expect(cfg.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    });
  });

  describe('batch — 32 capabilities in one run', () => {
    it('registers bits 70..101 without overflow', async () => {
      const before = await program.account.registryConfig.fetch(configPda);
      const registered: number[] = [];
      for (let b = 70; b < 102; b += 1) {
        const [tagPda] = capReg.tag(b);
        if (await hasTag(program, tagPda)) continue;
        await program.methods
          .proposeTag(b, slug(`cap_${b}`), uri(`ipfs://cap-${b}`))
          .accountsPartial({
            tag: tagPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
          })
          .rpc({ commitment: 'confirmed' });
        registered.push(b);
      }
      const after = await program.account.registryConfig.fetch(configPda);
      expect(after.tagCount - before.tagCount).to.equal(registered.length);
      for (const b of registered) {
        expect(after.approvedMask.testn(b), `bit ${b} set`).to.equal(true);
      }
    });
  });

  describe('invariants', () => {
    it('program id matches Anchor.toml', () => {
      expect(program.programId.toBase58()).to.equal(
        PROGRAM_IDS.capability_registry.toBase58(),
      );
    });
  });

  after(() => {
    void airdrop;
  });
});
