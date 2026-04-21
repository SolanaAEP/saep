'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { buildRegisterAgentIx, type RegisterAgentInput } from '@saep/sdk';
import { useAgentRegistryProgram } from './program.js';

export function useRegisterAgent() {
  const program = useAgentRegistryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<RegisterAgentInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const mintInfo = await connection.getAccountInfo(input.stakeMint, 'confirmed');
      if (!mintInfo) throw new Error('Stake mint not found on the current cluster');
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : mintInfo.owner.equals(TOKEN_PROGRAM_ID)
          ? TOKEN_PROGRAM_ID
          : null;
      if (!tokenProgramId) {
        throw new Error('Stake mint is not owned by SPL Token or Token-2022');
      }
      const registerInput = {
        ...input,
        operator: publicKey,
        tokenProgramId,
      } as RegisterAgentInput & { tokenProgramId?: PublicKey };
      const ix = await buildRegisterAgentIx(program, registerInput);
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
