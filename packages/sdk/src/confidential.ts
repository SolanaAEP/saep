import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getExtensionData,
  ExtensionType,
} from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';

const CONFIDENTIAL_TRANSFER_DISCRIMINATOR = 27;
const CT_CONFIGURE_ACCOUNT = 1;
const CT_APPROVE_ACCOUNT = 2;
const CT_APPLY_PENDING_BALANCE = 8;

export interface ConfidentialAccountStatus {
  isConfigured: boolean;
  isApproved: boolean;
  hasPendingBalance: boolean;
}

export async function getConfidentialAccountStatus(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<ConfidentialAccountStatus> {
  try {
    const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
    const ctData = getExtensionData(
      ExtensionType.ConfidentialTransferAccount,
      account.tlvData,
    );
    if (!ctData) {
      return { isConfigured: false, isApproved: false, hasPendingBalance: false };
    }
    const approved = ctData[0] === 1;
    const pendingLo = ctData.readBigUInt64LE(65);
    return {
      isConfigured: true,
      isApproved: approved,
      hasPendingBalance: pendingLo > 0n,
    };
  } catch {
    return { isConfigured: false, isApproved: false, hasPendingBalance: false };
  }
}

export function buildConfigureConfidentialAccountIx(
  tokenAccount: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  decryptableZeroBalance: Uint8Array,
  maximumPendingBalanceCreditCounter: bigint,
  proofInstructionOffset: number,
): TransactionInstruction {
  if (decryptableZeroBalance.length !== 36) {
    throw new Error('decryptableZeroBalance must be 36 bytes (AeCiphertext)');
  }

  const data = Buffer.alloc(1 + 1 + 36 + 8 + 1);
  let offset = 0;
  data.writeUInt8(CONFIDENTIAL_TRANSFER_DISCRIMINATOR, offset); offset += 1;
  data.writeUInt8(CT_CONFIGURE_ACCOUNT, offset); offset += 1;
  Buffer.from(decryptableZeroBalance).copy(data, offset); offset += 36;
  data.writeBigUInt64LE(maximumPendingBalanceCreditCounter, offset); offset += 8;
  data.writeInt8(proofInstructionOffset, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_2022_PROGRAM_ID,
    data,
  });
}

export function buildApplyPendingBalanceIx(
  tokenAccount: PublicKey,
  owner: PublicKey,
  expectedPendingBalanceCreditCounter: bigint,
  newDecryptableAvailableBalance: Uint8Array,
): TransactionInstruction {
  if (newDecryptableAvailableBalance.length !== 36) {
    throw new Error('newDecryptableAvailableBalance must be 36 bytes (AeCiphertext)');
  }

  const data = Buffer.alloc(1 + 1 + 8 + 36);
  let offset = 0;
  data.writeUInt8(CONFIDENTIAL_TRANSFER_DISCRIMINATOR, offset); offset += 1;
  data.writeUInt8(CT_APPLY_PENDING_BALANCE, offset); offset += 1;
  data.writeBigUInt64LE(expectedPendingBalanceCreditCounter, offset); offset += 8;
  Buffer.from(newDecryptableAvailableBalance).copy(data, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_2022_PROGRAM_ID,
    data,
  });
}

export function getConfidentialTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}
