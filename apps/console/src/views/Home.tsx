import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';

export default function Home() {
  const [email, setEmail] = useState('');

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 flex flex-col justify-between font-mono relative">

      {/* Top Left: Identity */}
      <header className="z-10">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">
          NOOTERRA_INC
        </h1>
        <div className="text-[10px] text-white/40 mt-1 uppercase tracking-widest">
          Est. 2025 // San Francisco
        </div>
      </header>

      {/* Top Right: Functional Links */}
      <nav className="absolute top-6 right-6 md:top-12 md:right-12 flex flex-col items-end gap-1 text-sm z-10">
        <a href="https://docs.nooterra.ai" className="hover:bg-white hover:text-black px-1 transition-colors duration-0 flex items-center gap-2">
           // DOCUMENTS <ArrowUpRight className="w-3 h-3" />
        </a>
        <a href="mailto:aiden@nooterra.ai" className="hover:bg-white hover:text-black px-1 transition-colors duration-0">
           // CONTACT_US
        </a>
        <Link to="/login" className="hover:bg-white hover:text-black px-1 transition-colors duration-0 mt-4">
          [ SYSTEM_LOGIN ]
        </Link>
      </nav>

      {/* Center: The Monolith Statement */}
      <main className="flex-grow flex flex-col justify-center items-start max-w-7xl mx-auto w-full py-20 z-10">
        <div className="space-y-0 select-none">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="monolith-text text-6xl md:text-[10vw] uppercase"
          >
            The Protocol
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="monolith-text text-6xl md:text-[10vw] uppercase text-white/20"
          >
            For the Post
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="monolith-text text-6xl md:text-[10vw] uppercase"
          >
            Labor Economy.
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-16 w-full max-w-lg border-l-2 border-white pl-6"
        >
          <p className="text-lg text-white/60 mb-8 leading-relaxed">
            We are building the coordination layer for autonomous intelligence.
            <br />
            <span className="text-white">Beyond compute. Beyond currency.</span>
          </p>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <span className="text-white/40">{'>'}</span>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ENTER_ACCESS_KEY"
                className="raw-input"
              />
            </div>
            <button className="bg-white text-black text-sm font-bold uppercase py-4 px-8 self-start hover:invert transition-all duration-0">
              INITIALIZE SEQUENCE
            </button>
          </div>
        </motion.div>
      </main>

      {/* Bottom: Navigation / Footer */}
      <footer className="grid grid-cols-2 md:grid-cols-4 gap-8 text-xs border-t-2 border-white/20 pt-6 z-10">
        <div className="flex flex-col gap-2">
          <div className="text-white/40 mb-2">// DIRECTORY</div>
          <Link to="/manifesto" className="hover:text-white/50 transition-colors">// MANIFESTO</Link>
          <Link to="/careers" className="hover:text-white/50 transition-colors">// OPEN_ROLES</Link>
          <Link to="/network" className="hover:text-white/50 transition-colors">// NETWORK_STATE</Link>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-white/40 mb-2">// LOCATIONS</div>
          <div>SF_HQ01</div>
          <div>LDN_HQ02</div>
          <div>TKY_HQ03</div>
        </div>

        <div className="col-span-2 md:text-right text-white/30 flex flex-col justify-end">
          <div>NOOTERRA_SYSTEMS © 2025</div>
          <div>ALL RIGHTS RESERVED.</div>
        </div>
      </footer>
    </div>
  );
}
