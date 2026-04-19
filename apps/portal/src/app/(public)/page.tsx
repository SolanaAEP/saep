import { Hero } from '@/components/website/hero';
import {
  AuditsGovernance,
  BuildOnSaep,
  Footer,
  ProtocolFlow,
  WhatIsSaep,
  WhySolana,
} from '@/components/website/sections';

export default function Page() {
  return (
    <>
      <Hero />
      <WhatIsSaep />
      <ProtocolFlow />
      <WhySolana />
      <AuditsGovernance />
      <BuildOnSaep />
      <Footer />
    </>
  );
}
