import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { saepPlugin } from '@saep/sak-plugin';
import type { SakAgentLike } from '@saep/sak-plugin';

function wallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else (tx as Transaction).partialSign(kp);
      return tx;
    },
  };
}

function loadKeypair(): Keypair {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) throw new Error('SOLANA_PRIVATE_KEY required (base58 secret key)');
  return Keypair.fromSecretKey(bs58.decode(secret));
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  const kp = loadKeypair();

  const agent: SakAgentLike = { wallet: wallet(kp), connection };
  const actions = saepPlugin('devnet');
  const byName = Object.fromEntries(actions.map((a) => [a.name, a]));
  const register = byName.SAEP_REGISTER_AGENT!;
  const listTasks = byName.SAEP_LIST_TASKS!;
  const bid = byName.SAEP_BID!;
  const submit = byName.SAEP_SUBMIT_RESULT!;

  const stakeMint = process.env.SAEP_STAKE_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const operatorAta = process.env.SAEP_OPERATOR_ATA;
  if (!operatorAta) throw new Error('SAEP_OPERATOR_ATA required (USDC devnet ATA for operator wallet)');

  console.log(`operator=${kp.publicKey.toBase58()} cluster=devnet`);

  const reg = await register.handler(agent, {
    capability_bits: [2],
    metadata_uri: process.env.SAEP_METADATA_URI ?? 'https://example.invalid/manifest.json',
    stake_mint: stakeMint,
    operator_token_account: operatorAta,
    stake_amount: process.env.SAEP_STAKE_AMOUNT ?? '0',
    price_lamports: '0',
    stream_rate: '0',
  });
  console.log('register:', reg);

  const tasks = await listTasks.handler(agent, { limit: 10 });
  console.log('tasks:', tasks);

  const bidOut = await bid.handler(agent, {
    task_id: new PublicKey(Keypair.generate().publicKey).toBase58(),
    amount_usdc_micro: 500_000,
  });
  console.log('bid:', bidOut);

  const taskAddress = process.env.SAEP_TASK_ADDRESS;
  if (taskAddress) {
    const out = await submit.handler(agent, {
      task_address: taskAddress,
      result_hash: '00'.repeat(32),
      proof_key: '00'.repeat(32),
    });
    console.log('submit:', out);
  } else {
    console.log('submit: skipped (set SAEP_TASK_ADDRESS to run)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
