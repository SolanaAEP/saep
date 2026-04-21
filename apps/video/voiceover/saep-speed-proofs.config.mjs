export const voiceoverConfig = {
  title: 'SAEP Speed Proofs',
  model: null,
  voice: 'ara',
  sampleRate: 24000,
  remotionStaticPath: 'audio/saep-speed-proofs-voiceover.wav',
  outputFile: 'public/audio/saep-speed-proofs-voiceover.wav',
  transcriptFile: 'public/audio/saep-speed-proofs-voiceover-script.txt',
  metadataFile: 'public/audio/saep-speed-proofs-voiceover.json',
  systemPrompt: `Read the supplied narration as a concise, premium product explainer. Sound calm, warm, technical, and confident. Deliver it as one clean, continuous studio take with steady forward momentum. Never stop, break, or trail off in the middle of a word or phrase, and avoid long pauses between sentences. Keep the pacing precise and slightly brisk so the narration lands in about 31 seconds. Always pronounce "SAEP" as the letters "S A E P", never as the word "seep". Put slight emphasis on "S A E P fixes that", "less than one slot", and "proofs before payout". Do not add extra words.`,
  scriptText:
    "Agent economies break when trust is manual and payment clears too late. S A E P fixes that. On Solana, Agent A hires Agent B on-chain. S A E P escrows the job, proves completion, and pays in less than one slot. XRP can route in. Pyth prices the path. S A E P locks the escrow. At swarm scale, agents bid, execute, prove, and settle in one live loop, because Solana is fast and S A E P requires proofs before payout.",
  segments: [
    {
      label: 'intro',
      startSeconds: 0,
      endSeconds: 5.0,
      text: 'Agent economies break when trust is manual and payment clears too late. S A E P fixes that.',
    },
    {
      label: 'hire',
      startSeconds: 5.0,
      endSeconds: 14.1,
      text: 'On Solana, Agent A hires Agent B on-chain. S A E P escrows the job, proves completion, and pays in less than one slot.',
    },
    {
      label: 'bridge',
      startSeconds: 14.1,
      endSeconds: 20.7,
      text: 'XRP can route in. Pyth prices the path. S A E P locks the escrow.',
    },
    {
      label: 'swarm',
      startSeconds: 20.7,
      endSeconds: 25.5,
      text: 'At swarm scale, agents bid, execute, prove, and settle in one live loop,',
    },
    {
      label: 'outro',
      startSeconds: 25.5,
      endSeconds: 32.0,
      text: 'because Solana is fast and S A E P requires proofs before payout.',
    },
  ],
};
