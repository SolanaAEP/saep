import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  fetchAllTemplates,
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
  templateRegistryProgram,
} from '@saep/sdk';
import { PublicKey } from '@solana/web3.js';
import {
  useTemplateRegistryConfig,
  useAllTemplates,
  useTemplate,
  useTemplateForks as useTemplateForksHook,
  useTemplateRentals,
} from '../hooks/templates.js';
import { createWrapper, MOCK_PUBKEY, mockAnchorWallet, mockConnection } from './helpers.tsx';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
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
