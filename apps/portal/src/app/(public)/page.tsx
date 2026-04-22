import { Hero } from '@/components/website/hero';
import { RoadmapSnapshot } from '@/components/website/roadmap';
import {
  BuildOnSaep,
  Footer,
  LaunchFilm,
  ProtocolFlow,
  WhatIsSaep,
  WhySolana,
} from '@/components/website/sections';

export default function Page() {
  return (
    <>
      <Hero />
      <LaunchFilm />
      <WhatIsSaep />
      <ProtocolFlow />
      <WhySolana />
      <RoadmapSnapshot />
      <BuildOnSaep />
      <Footer />
    </>
  );
}
