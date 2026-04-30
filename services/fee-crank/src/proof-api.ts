import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { PublicKey } from '@solana/web3.js';
import { MerkleTree, governanceLeaf, feeClaimLeaf, toHex } from '@saep/sdk';
import { loadSnapshot, loadLatestSnapshot, loadSnapshotBySlot } from './db.js';

export function registerProofRoutes(app: FastifyInstance, db: pg.Pool) {
  app.get('/snapshot/latest', async () => {
    const snap = await loadLatestSnapshot(db);
    if (!snap) return { error: 'no snapshots' };
    return {
      epoch: snap.epochId.toString(),
      governanceRoot: Array.from(snap.governanceRoot),
      totalVotingPower: snap.totalVotingPower.toString(),
      stakerCount: snap.stakerCount,
      snapshotSlot: snap.snapshotSlot.toString(),
    };
  });

  app.get<{ Params: { slot: string; wallet: string } }>(
    '/snapshot/by-slot/:slot/proof/:wallet',
    async (req, reply) => {
      const slot = BigInt(req.params.slot);
      const wallet = req.params.wallet;
      const snap = await loadSnapshotBySlot(db, slot);
      if (!snap) return reply.code(404).send({ error: 'snapshot not found for slot' });

      const idx = snap.governanceLeaves.findIndex((l) => l.wallet === wallet);
      if (idx === -1) return reply.code(404).send({ error: 'wallet not in snapshot' });

      const leaves = snap.governanceLeaves.map((l) =>
        governanceLeaf(new PublicKey(l.wallet), BigInt(l.weight)),
      );
      const tree = new MerkleTree(leaves);
      const proof = tree.getProof(idx);

      return {
        weight: snap.governanceLeaves[idx]!.weight,
        proof: proof.map((p) => Array.from(p)),
        leafIndex: idx,
        epoch: snap.epochId.toString(),
      };
    },
  );

  app.get<{ Params: { epoch: string; wallet: string } }>(
    '/snapshot/:epoch/proof/:wallet',
    async (req, reply) => {
      const epochId = BigInt(req.params.epoch);
      const wallet = req.params.wallet;
      const snap = await loadSnapshot(db, epochId);
      if (!snap) return reply.code(404).send({ error: 'epoch not found' });

      const idx = snap.governanceLeaves.findIndex((l) => l.wallet === wallet);
      if (idx === -1) return reply.code(404).send({ error: 'wallet not in snapshot' });

      const leaves = snap.governanceLeaves.map((l) =>
        governanceLeaf(new PublicKey(l.wallet), BigInt(l.weight)),
      );
      const tree = new MerkleTree(leaves);
      const proof = tree.getProof(idx);

      return {
        weight: snap.governanceLeaves[idx]!.weight,
        proof: proof.map((p) => Array.from(p)),
        leafIndex: idx,
      };
    },
  );

  app.get<{ Params: { epoch: string; wallet: string } }>(
    '/distribution/:epoch/proof/:wallet',
    async (req, reply) => {
      const epochId = BigInt(req.params.epoch);
      const wallet = req.params.wallet;
      const snap = await loadSnapshot(db, epochId);
      if (!snap) return reply.code(404).send({ error: 'epoch not found' });

      const idx = snap.feeLeaves.findIndex((l) => l.wallet === wallet);
      if (idx === -1) return reply.code(404).send({ error: 'wallet not in distribution' });

      const leaves = snap.feeLeaves.map((l) =>
        feeClaimLeaf(new PublicKey(l.wallet), BigInt(l.amount), BigInt(l.epochId)),
      );
      const tree = new MerkleTree(leaves);
      const proof = tree.getProof(idx);

      return {
        amount: snap.feeLeaves[idx]!.amount,
        proof: proof.map((p) => Array.from(p)),
        leafIndex: idx,
      };
    },
  );
}
