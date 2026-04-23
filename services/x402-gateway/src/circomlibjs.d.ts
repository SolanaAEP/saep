declare module 'circomlibjs' {
  type PoseidonFn = ((inputs: readonly bigint[]) => unknown) & {
    F: {
      toString(value: unknown): string;
    };
  };

  export function buildPoseidon(): Promise<PoseidonFn>;
}
