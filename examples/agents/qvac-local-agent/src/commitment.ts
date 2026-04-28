import { createHash } from 'node:crypto';

export type ExecutionCommitment = {
  resultHash: Uint8Array;
  proofKey: Uint8Array;
  preimage: {
    taskHashHex: string;
    resultHashHex: string;
    llmSrc: string;
    embedSrc: string;
    issuedAt: number;
  };
};

export function hashOutput(output: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(output, 'utf8').digest());
}

export function buildExecutionCommitment(opts: {
  taskHash: Uint8Array;
  output: string;
  llmSrc: string;
  embedSrc: string;
  issuedAt?: number;
}): ExecutionCommitment {
  const resultHash = hashOutput(opts.output);
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const taskHashHex = Buffer.from(opts.taskHash).toString('hex');
  const resultHashHex = Buffer.from(resultHash).toString('hex');
  const issuedAtBuf = Buffer.alloc(8);
  issuedAtBuf.writeBigInt64LE(BigInt(issuedAt));

  const proofKey = Uint8Array.from(
    createHash('sha256')
      .update(opts.taskHash)
      .update(resultHash)
      .update(opts.llmSrc, 'utf8')
      .update(opts.embedSrc, 'utf8')
      .update(issuedAtBuf)
      .digest(),
  );

  return {
    resultHash,
    proofKey,
    preimage: {
      taskHashHex,
      resultHashHex,
      llmSrc: opts.llmSrc,
      embedSrc: opts.embedSrc,
      issuedAt,
    },
  };
}
