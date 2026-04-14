declare module 'snarkjs' {
  export namespace groth16 {
    function fullProve(
      input: Record<string, unknown>,
      wasm: string,
      zkey: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;

    function verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  }
}
