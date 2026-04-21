import { Hero } from '@/components/website/hero';
import {
  AuditsGovernance,
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
      <AuditsGovernance />
      <BuildOnSaep />
      <Footer />
    </>
  );
}
