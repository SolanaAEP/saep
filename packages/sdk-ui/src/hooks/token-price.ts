'use client';

import { useQuery } from '@tanstack/react-query';

export interface TokenPrice {
  price: number;
}

export function useTokenPrice(mint: string | null) {
  return useQuery<TokenPrice | null>({
    queryKey: ['token-price', mint],
    enabled: Boolean(mint),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      if (!res.ok) throw new Error(`Jupiter price API error: ${res.status}`);
      const json = await res.json();
      const entry = json.data?.[mint!];
      if (!entry?.price) return null;
      return { price: Number(entry.price) };
    },
  });
}
