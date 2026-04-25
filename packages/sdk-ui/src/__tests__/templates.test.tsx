import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  buildClaimRentalRevenueIx,
  buildCloseRentalIx,
  buildForkTemplateIx,
  buildOpenRentalIx,
  fetchAllTemplates,
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
  fetchTemplateRentalsByRenter,
  templateRegistryProgram,
} from '@saep/sdk';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  useClaimRentalRevenue,
  useCloseTemplateRental,
  useTemplateRegistryConfig,
  useAllTemplates,
  useTemplate,
  useTemplateForks as useTemplateForksHook,
  useForkTemplate,
  useRentTemplate,
  useTemplateRentals,
  useTemplateRentalsByRenter,
} from '../hooks/templates.js';
import {
  createWrapper,
  MOCK_PUBKEY,
  MOCK_PUBKEY_2,
  mockAnchorWallet,
  mockConnection,
  mockWallet,
} from './helpers.tsx';

vi.mock('@solana/spl-token', async () => {
  const actual = await vi.importActual<typeof import('@solana/spl-token')>('@solana/spl-token');
  const { PublicKey } = await import('@solana/web3.js');
  return {
    ...actual,
    getAssociatedTokenAddressSync: vi.fn(() => new PublicKey('11111111111111111111111111111113')),
  };
});

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockWallet({ publicKey: null, connected: false });
  mockAnchorWallet();
  vi.mocked(templateRegistryProgram).mockReturnValue(mockProgramInstance);
});

describe('useTemplateRegistryConfig', () => {
  it('fetches registry config', async () => {
    const config = { paused: false };
    vi.mocked(fetchTemplateRegistryConfig).mockResolvedValue(config as any);

    const { result } = renderHook(() => useTemplateRegistryConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTemplateRegistryConfig).toHaveBeenCalledWith(mockProgramInstance);
    expect(result.current.data).toEqual(config);
  });
});

describe('useAllTemplates', () => {
  it('fetches all templates', async () => {
    const templates = [{ templateId: 'a'.repeat(64) }];
    vi.mocked(fetchAllTemplates).mockResolvedValue(templates as any);

    const { result } = renderHook(() => useAllTemplates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAllTemplates).toHaveBeenCalledWith(mockProgramInstance);
    expect(result.current.data).toEqual(templates);
  });
});

describe('useTemplate', () => {
  const validHex = 'c'.repeat(64);

  it('fetches a template by id', async () => {
    const template = { templateId: validHex };
    vi.mocked(fetchTemplateById).mockResolvedValue(template as any);

    const { result } = renderHook(() => useTemplate(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTemplateById).toHaveBeenCalledWith(mockProgramInstance, validHex);
    expect(result.current.data).toEqual(template);
  });

  it('stays disabled for invalid ids', () => {
    const { result } = renderHook(() => useTemplate('short'), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useTemplateForks', () => {
  it('fetches forks for a template address', async () => {
    const forks = [{ address: 'fork' }];
    vi.mocked(fetchTemplateForks).mockResolvedValue(forks as any);

    const { result } = renderHook(() => useTemplateForksHook(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTemplateForks).toHaveBeenCalledWith(mockProgramInstance, MOCK_PUBKEY);
    expect(result.current.data).toEqual(forks);
  });
});

describe('useTemplateRentals', () => {
  it('fetches rentals for a template address', async () => {
    const rentals = [{ address: 'rental' }];
    const template = PublicKey.unique();
    vi.mocked(fetchTemplateRentals).mockResolvedValue(rentals as any);

    const { result } = renderHook(() => useTemplateRentals(template), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTemplateRentals).toHaveBeenCalledWith(mockProgramInstance, template);
    expect(result.current.data).toEqual(rentals);
  });
});

describe('useTemplateRentalsByRenter', () => {
  it('fetches rentals for a renter', async () => {
    const rentals = [{ address: 'rental' }];
    const renter = PublicKey.unique();
    vi.mocked(fetchTemplateRentalsByRenter).mockResolvedValue(rentals as any);

    const { result } = renderHook(() => useTemplateRentalsByRenter(renter), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTemplateRentalsByRenter).toHaveBeenCalledWith(mockProgramInstance, renter);
    expect(result.current.data).toEqual(rentals);
  });
});

describe('useRentTemplate', () => {
  const mockIx = new TransactionInstruction({
    keys: [],
    programId: MOCK_PUBKEY,
    data: Buffer.alloc(8),
  });

  it('builds an open rental transaction with detected token program', async () => {
    vi.mocked(buildOpenRentalIx).mockResolvedValue(mockIx);
    mockWallet();

    const { result } = renderHook(() => useRentTemplate(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      templateId: new Uint8Array(32).fill(1),
      mint: MOCK_PUBKEY,
      durationSecs: 3600n,
      rentalNonce: new Uint8Array(8).fill(2),
      renterTokenAccount: MOCK_PUBKEY_2,
    });

    expect(buildOpenRentalIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({
        renter: MOCK_PUBKEY,
        mint: MOCK_PUBKEY,
        durationSecs: 3600n,
        renterTokenAccount: MOCK_PUBKEY_2,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rejects writes when the wallet is missing', async () => {
    const { result } = renderHook(() => useRentTemplate(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        templateId: new Uint8Array(32),
        mint: MOCK_PUBKEY,
        durationSecs: 1n,
        rentalNonce: new Uint8Array(8),
      }),
    ).rejects.toThrow('Wallet not connected');
    expect(buildOpenRentalIx).not.toHaveBeenCalled();
  });

  it('rejects malformed rental nonce before building', async () => {
    mockWallet();

    const { result } = renderHook(() => useRentTemplate(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        templateId: new Uint8Array(32),
        mint: MOCK_PUBKEY,
        durationSecs: 1n,
        rentalNonce: new Uint8Array(4),
      }),
    ).rejects.toThrow('rentalNonce must be 8 bytes');
    expect(buildOpenRentalIx).not.toHaveBeenCalled();
  });
});

describe('useForkTemplate', () => {
  const mockIx = new TransactionInstruction({
    keys: [],
    programId: MOCK_PUBKEY,
    data: Buffer.alloc(8),
  });

  it('builds a fork lineage transaction', async () => {
    vi.mocked(buildForkTemplateIx).mockResolvedValue(mockIx);
    mockWallet();

    const { result } = renderHook(() => useForkTemplate(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      parentTemplateId: new Uint8Array(32).fill(1),
      childAgentDid: new Uint8Array(32).fill(3),
    });

    expect(buildForkTemplateIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({
        forker: MOCK_PUBKEY,
        childAgentDid: new Uint8Array(32).fill(3),
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('template rental management hooks', () => {
  const mockIx = new TransactionInstruction({
    keys: [],
    programId: MOCK_PUBKEY,
    data: Buffer.alloc(8),
  });

  it('builds a claim rental revenue transaction', async () => {
    vi.mocked(buildClaimRentalRevenueIx).mockResolvedValue(mockIx);
    mockWallet();
    const mint = Keypair.generate().publicKey;
    const author = Keypair.generate().publicKey;
    const rental = Keypair.generate().publicKey;
    const feeCollectorTokenAccount = Keypair.generate().publicKey;

    const { result } = renderHook(() => useClaimRentalRevenue(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      rental,
      templateId: new Uint8Array(32).fill(1),
      mint,
      author,
      feeCollectorTokenAccount,
    });

    expect(buildClaimRentalRevenueIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({
        cranker: MOCK_PUBKEY,
        rental,
        mint,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('builds a close rental transaction', async () => {
    vi.mocked(buildCloseRentalIx).mockResolvedValue(mockIx);
    mockWallet();
    const mint = Keypair.generate().publicKey;
    const author = Keypair.generate().publicKey;
    const renter = Keypair.generate().publicKey;
    const rental = Keypair.generate().publicKey;
    const feeCollectorTokenAccount = Keypair.generate().publicKey;

    const { result } = renderHook(() => useCloseTemplateRental(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      rental,
      templateId: new Uint8Array(32).fill(1),
      mint,
      author,
      feeCollectorTokenAccount,
      renter,
    });

    expect(buildCloseRentalIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({
        signer: MOCK_PUBKEY,
        rental,
        mint,
        feeCollectorTokenAccount,
        renterTokenAccount: expect.any(PublicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
