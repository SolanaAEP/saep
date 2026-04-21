import * as anchor from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROGRAM_IDS = {
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
};

function loadIdl(name: string): anchor.Idl {
  const candidates = [
    resolve(process.cwd(), `target/idl/${name}.json`),
    resolve(process.cwd(), `packages/sdk/src/idl/${name}.json`),
  ];
  const filepath = candidates.find((candidate) => existsSync(candidate));
  if (!filepath) {
    throw new Error(`missing IDL for ${name}`);
  }
  return JSON.parse(readFileSync(filepath, 'utf8'));
}

function encodeFixedBytes(input: string, size: number): number[] {
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length > size) {
    throw new Error(`${input} exceeds ${size} bytes`);
  }
  return Array.from(Buffer.concat([bytes, Buffer.alloc(size - bytes.length)]));
}

function pda(programId: PublicKey, ...seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const conn = provider.connection;

  const stakeMint = await createMint(
    conn,
    payer,
    authority,
    null,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );

  console.log(`created stake mint: ${stakeMint.toBase58()}`);

  const agentRegistry = new anchor.Program(
    loadIdl('agent_registry'),
    provider,
  );
  const taskMarket = new anchor.Program(
    loadIdl('task_market'),
    provider,
  );
  const registryGlobal = pda(agentRegistry.programId, Buffer.from('global'));
  const registryState = await agentRegistry.account.registryGlobal.fetch(registryGlobal);

  await agentRegistry.methods
    .setStakeMint(stakeMint)
    .accountsPartial({
      authority,
      stakeMintInfo: stakeMint,
    })
    .rpc({ commitment: 'confirmed' });
  console.log('agent_registry: stake mint updated');

  await taskMarket.methods
    .setAllowedMint(0, stakeMint)
    .accountsPartial({ authority })
    .rpc({ commitment: 'confirmed' });
  console.log('task_market: allowed payment mint slot 0 updated');

  const sampleSeed = process.env.SAEP_DEVNET_SAMPLE_AGENT_SEED;
  if (!sampleSeed) {
    return;
  }

  const guard = pda(agentRegistry.programId, Buffer.from('guard'));
  const allowedCallers = pda(agentRegistry.programId, Buffer.from('allowed_callers'));
  if (!(await conn.getAccountInfo(guard))) {
    await agentRegistry.methods
      .initGuard([])
      .accounts({
        global: registryGlobal,
        guard,
        allowedCallers,
        authority,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc({ commitment: 'confirmed' });
    console.log('agent_registry: guard initialized');
  }

  const agentId = Uint8Array.from(encodeFixedBytes(sampleSeed, 32));
  const capabilityConfig = pda(
    registryState.capabilityRegistry,
    Buffer.from('config'),
  );
  const agent = pda(
    agentRegistry.programId,
    Buffer.from('agent'),
    authority.toBuffer(),
    agentId,
  );
  const stakeVault = pda(
    agentRegistry.programId,
    Buffer.from('stake'),
    agent.toBuffer(),
  );
  const operatorAta = getAssociatedTokenAddressSync(
    stakeMint,
    authority,
    false,
    TOKEN_PROGRAM_ID,
  );
  const ataTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      authority,
      operatorAta,
      authority,
      stakeMint,
      TOKEN_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(conn, ataTx, [payer], { commitment: 'confirmed' });

  await agentRegistry.methods
    .registerAgent(
      Array.from(agentId),
      encodeFixedBytes(`https://buildonsaep.com/agents/${sampleSeed}`, 128),
      new anchor.BN(1), // capability bit 0
      new anchor.BN(0),
      new anchor.BN(0),
      new anchor.BN(0),
    )
    .accounts({
      global: registryGlobal,
      capabilityConfig,
      agent,
      stakeMint,
      stakeVault,
      operatorTokenAccount: operatorAta,
      operator: authority,
      personhoodAttestation: null,
      guard,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc({ commitment: 'confirmed' });
  console.log(`agent_registry: sample agent registered (${sampleSeed})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
