'use client';

import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import {
  fetchAllTemplates,
  fetchTemplateById,
  fetchTemplateForks,
  fetchTemplateRegistryConfig,
  fetchTemplateRentals,
} from '@saep/sdk';
import { useTemplateRegistryProgram } from './program.js';

export function useTemplateRegistryConfig() {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-registry', 'config'],
    enabled: Boolean(program),
    queryFn: () => fetchTemplateRegistryConfig(program!),
    staleTime: 30_000,
  });
}

export function useAllTemplates() {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['templates', 'all'],
    enabled: Boolean(program),
    queryFn: () => fetchAllTemplates(program!),
    staleTime: 30_000,
  });
}

export function useTemplate(templateIdHex: string | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template', templateIdHex],
    enabled: Boolean(program && templateIdHex && templateIdHex.length === 64),
    queryFn: () => fetchTemplateById(program!, templateIdHex!),
    staleTime: 30_000,
  });
}

export function useTemplateForks(parentTemplate: PublicKey | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-forks', parentTemplate?.toBase58()],
    enabled: Boolean(program && parentTemplate),
    queryFn: () => fetchTemplateForks(program!, parentTemplate!),
    staleTime: 30_000,
  });
}

export function useTemplateRentals(template: PublicKey | null) {
  const program = useTemplateRegistryProgram();
  return useQuery({
    queryKey: ['template-rentals', template?.toBase58()],
    enabled: Boolean(program && template),
    queryFn: () => fetchTemplateRentals(program!, template!),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
