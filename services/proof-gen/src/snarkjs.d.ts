declare module 'snarkjs' {
  interface Groth16Proof {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
  }

  interface Groth16VerificationKey {
    protocol: string;
    curve: string;
    nPublic: number;
    vk_alpha_1: string[];
    vk_beta_2: string[][];
    vk_gamma_2: string[][];
    vk_delta_2: string[][];
    IC: string[][];
  }

  export namespace groth16 {
    function fullProve(
      input: Record<string, unknown>,
      wasm: string,
      zkey: string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;

    function verify(
      vkey: Groth16VerificationKey,
      publicSignals: string[],
      proof: Groth16Proof,
    ): Promise<boolean>;
  }
}
