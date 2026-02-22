import SiteNav from "./components/SiteNav.jsx";
import Hero from "./components/Hero.jsx";
import SocialProofStrip from "./components/SocialProofStrip.jsx";
import KernelNow from "./components/KernelNow.jsx";
import Vision from "./components/Vision.jsx";
import Quickstart from "./components/Quickstart.jsx";
import FaqSection from "./components/FaqSection.jsx";
import FinalCta from "./components/FinalCta.jsx";
import SiteFooter from "./components/SiteFooter.jsx";

export default function SiteShell() {
  return (
    <div className="site-root" id="top">
      <div className="site-bg-texture" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-a" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-b" aria-hidden="true" />
      <SiteNav />
      <main>
        <Hero />
        <SocialProofStrip />
        <KernelNow />
        <Vision />
        <Quickstart />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
