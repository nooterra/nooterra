import React from 'react';
import Logo from '../../../../ChatGPT Image Dec 7, 2025, 08_19_14 PM.png';

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white font-mono antialiased">
      <div className="flex flex-col min-h-screen p-8 md:p-12 lg:p-16">
        <header className="flex justify-between items-start w-full mb-16 md:mb-24">
          <div className="flex items-center gap-4">
            <img
              src={Logo}
              alt="Nooterra"
              className="h-8 w-auto object-contain filter invert"
            />
            <h1 className="text-xl md:text-2xl font-normal tracking-[0.2em]">
              NOOTERRA
            </h1>
          </div>
          <div className="flex flex-col items-end space-y-4">
            <a
              href="#"
              className="text-sm tracking-widest hover:opacity-75 transition-opacity"
            >
              JOIN THE WAITLIST
            </a>
            <div className="w-20 h-px bg-white" />
          </div>
        </header>

        <main className="flex-grow flex flex-col justify-between w-full">
          <div className="w-full">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
              <div className="lg:col-span-2">
                <div className="flex items-center gap-4">
                  <span className="text-xs tracking-widest">01//INTRO</span>
                  <div className="flex-grow h-px bg-white opacity-50" />
                </div>
                <h2 className="text-5xl md:text-7xl lg:text-8xl mt-6 font-light leading-none tracking-wider">
                  INTELLIGENT
                  <br />
                  MACHINE
                  <br />
                  ECONOMY
                </h2>
              </div>
              <div />
              <div className="lg:col-span-2 mt-16 md:mt-24">
                <div className="flex items-center gap-4">
                  <span className="text-xs tracking-widest">OPERATIONAL</span>
                  <div className="flex-grow h-px bg-white opacity-50" />
                </div>
                <p className="mt-6 text-sm md:text-base font-light leading-relaxed max-w-xl text-white/80">
                  Machines are beginning to act with autonomy. What they lack is a shared
                  environment — a coherent space where their decisions, outputs, and
                  interactions gain structure, permanence, and meaning. Nooterra establishes
                  this foundation. A neutral substrate where intelligent systems can operate,
                  exchange value, produce verifiable outcomes, and participate in a broader
                  computational order.
                </p>
              </div>
            </div>
          </div>

          <div className="w-full mt-16 md:mt-24">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-16 items-end">
              <div className="lg:col-span-2">
                <div className="flex flex-col sm:flex-row gap-8">
                  <div className="flex flex-col items-start">
                    <span className="text-xs tracking-widest">02//DOCUMENTATION</span>
                    <div className="w-full h-px bg-white mt-2 mb-4" />
                    <a
                      href="https://docs.nooterra.ai"
                      target="_blank"
                      rel="noreferrer"
                      className="text-lg tracking-wider font-normal hover:opacity-75 transition-opacity"
                    >
                      EXPLORE THE PROTOCOL →
                    </a>
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-end gap-8">
                <div className="flex-shrink-0">
                  <div className="w-20 h-20 md:w-24 md:h-24 border border-white relative">
                    <div className="absolute inset-0 m-2 diagonal-lines text-white/50" />
                    <div className="absolute -top-3 -right-3 w-6 h-6 border border-white rounded-full" />
                  </div>
                </div>
                <div className="flex-grow">
                  <div className="flex items-center gap-3">
                    <div className="w-full h-px bg-white/30" />
                    <div className="w-3 h-3 border border-white rounded-full" />
                    <div className="w-3 h-3 bg-white/50 rounded-full" />
                    <div className="w-3 h-3 bg-white rounded-full" />
                  </div>
                  <div className="flex justify-end mt-4">
                    <div className="w-10 h-px bg-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
