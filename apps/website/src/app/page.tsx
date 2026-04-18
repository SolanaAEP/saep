import { Hero } from '@/components/hero';
import {
  AuditsGovernance,
  BuildOnSaep,
  Footer,
  ProtocolFlow,
  WhatIsSaep,
  WhySolana,
} from '@/components/sections';

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
