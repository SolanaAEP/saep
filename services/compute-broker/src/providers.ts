export type LeaseRequest = {
  gpuHours: number;
  durationSecs: number;
  capabilityHints?: string[];
};

export type LeaseReservation = {
  leaseId: string;
  gpuHours: number;
  expiresAt: number;
  pricedUsdMicro: number;
};

export interface ComputeProvider {
  readonly name: 'ionet' | 'akash';
  reserve(req: LeaseRequest): Promise<LeaseReservation>;
  activate(leaseId: string): Promise<void>;
  cancel(leaseId: string): Promise<{ refundUsdMicro: number }>;
  reclaim(leaseId: string): Promise<void>;
  status(leaseId: string): Promise<'reserved' | 'active' | 'cancelled' | 'reclaimed'>;
}

export class IonetProviderStub implements ComputeProvider {
  readonly name = 'ionet' as const;
  async reserve(req: LeaseRequest): Promise<LeaseReservation> {
    throw new Error(
      'NOT_YET_WIRED: io.net /leases/reserve integration pending partnership onboarding (backlog P2_depin_compute_bond.md step 1).',
    );
  }
  async activate(_leaseId: string): Promise<void> {
    throw new Error('NOT_YET_WIRED: io.net lease activation');
  }
  async cancel(_leaseId: string): Promise<{ refundUsdMicro: number }> {
    throw new Error('NOT_YET_WIRED: io.net lease cancel');
  }
  async reclaim(_leaseId: string): Promise<void> {
    throw new Error('NOT_YET_WIRED: io.net lease reclaim');
  }
  async status(_leaseId: string): Promise<'reserved' | 'active' | 'cancelled' | 'reclaimed'> {
    throw new Error('NOT_YET_WIRED: io.net lease status');
  }
}

export class AkashProviderStub implements ComputeProvider {
  readonly name = 'akash' as const;
  async reserve(_req: LeaseRequest): Promise<LeaseReservation> {
    throw new Error('NOT_YET_WIRED: akash SDL deploy');
  }
  async activate(_leaseId: string): Promise<void> {
    throw new Error('NOT_YET_WIRED: akash activate');
  }
  async cancel(_leaseId: string): Promise<{ refundUsdMicro: number }> {
    throw new Error('NOT_YET_WIRED: akash cancel');
  }
  async reclaim(_leaseId: string): Promise<void> {
    throw new Error('NOT_YET_WIRED: akash reclaim');
  }
  async status(_leaseId: string): Promise<'reserved' | 'active' | 'cancelled' | 'reclaimed'> {
    throw new Error('NOT_YET_WIRED: akash status');
  }
}

export function selectProvider(
  requested: 'ionet' | 'akash',
  providers: { ionet: ComputeProvider; akash: ComputeProvider },
): ComputeProvider {
  return requested === 'ionet' ? providers.ionet : providers.akash;
}
