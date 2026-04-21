import {Composition} from 'remotion';
import {SaepSpeedProofs, TOTAL_FRAMES} from './SaepSpeedProofs';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="SaepSpeedProofs"
        component={SaepSpeedProofs}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          layout: 'landscape' as const,
          voiceoverSrc: 'audio/saep-speed-proofs-voiceover.wav',
          voiceoverPlaybackRate: 1,
        }}
      />
      <Composition
        id="SaepSpeedProofsPortrait"
        component={SaepSpeedProofs}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          layout: 'portrait' as const,
          voiceoverSrc: 'audio/saep-speed-proofs-voiceover.wav',
          voiceoverPlaybackRate: 1,
        }}
      />
    </>
  );
};
