import Navbar from "../../components/ui/Navbar";
import Hero from "../../components/Hero";
import WhyNow from "../../components/WhyNow";
import Mechanics from "../../components/Mechanics";
import Developers from "../../components/Developers";
import Footer from "../../components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-black overflow-x-hidden text-white">
      <Navbar />
      <main className="flex flex-col w-full">
        <Hero />
        <WhyNow />
        <Mechanics />
        <Developers />
      </main>
      <Footer />
    </div>
  );
}
