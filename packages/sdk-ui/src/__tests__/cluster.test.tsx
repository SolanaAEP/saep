import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCluster } from '../hooks/cluster.js';
import { createWrapper, MOCK_CLUSTER } from './helpers.js';

describe('useCluster', () => {
  it('returns the cluster config from ClusterContext.Provider', () => {
    const { result } = renderHook(() => useCluster(), { wrapper: createWrapper() });
    expect(result.current).toBe(MOCK_CLUSTER);
  });

  it('throws when used outside a ClusterProvider', () => {
    expect(() => renderHook(() => useCluster())).toThrow(
      /useCluster must be used inside <ClusterProvider>/,
    );
  });
});
