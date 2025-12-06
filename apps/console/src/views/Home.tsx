import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hero3D } from '../components/ui/Hero3D';
import { TextReveal } from '../components/ui/TextReveal';
import { GlowButton } from '../components/ui/GlowButton';
import { motion } from 'framer-motion';
import { ArrowUpRight, Mail, FileText, Terminal } from 'lucide-react';

export default function Home() {
  const [email, setEmail] = useState('');

  return (
    <div className="min-h-screen bg-transparent relative overflow-hidden flex flex-col items-center justify-center text-center px-4 font-mono">
      {/* 3D Background */}
      <div className="fixed inset-0 z-0">
        <Hero3D />
      </div>

      {/* Top Navigation (Minimal) */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-0 left-0 right-0 p-8 flex justify-between items-start z-50 mix-blend-difference"
      >
        <div className="text-xs font-bold tracking-[0.2em] text-white/50">
          SYSTEM_STATUS: <span className="text-green-500">ONLINE</span>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs font-bold tracking-[0.2em]">
          <a href="https://docs.nooterra.ai" target="_blank" rel="noreferrer" className="text-white/50 hover:text-accent transition-colors flex items-center gap-1 group">
            DOCS <ArrowUpRight className="w-3 h-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
          <a href="mailto:aiden@nooterra.ai" className="text-white/50 hover:text-white transition-colors flex items-center gap-1">
            CONTACT
          </a>
        </div>
      </motion.nav>

      {/* Content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto space-y-16 mt-10">
        <div className="space-y-6">
          {/* Cryptic Header */}
          <div className="h-24 md:h-32 flex items-center justify-center overflow-hidden">
            <TextReveal
              text="NOOTERRA"
              className="text-6xl md:text-9xl font-bold font-sans tracking-tighter text-white glow-text"
              delay={0.2}
            />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.5, duration: 1 }}
            className="space-y-4"
          >
            <p className="text-lg md:text-2xl text-foreground/80 font-mono tracking-wide max-w-3xl mx-auto leading-relaxed">
              The coordination layer for the <span className="text-white bg-white/10 px-1">post-labor economy</span>.
            </p>
            <p className="text-sm md:text-base text-foreground/40 font-mono max-w-2xl mx-auto">
              Orchestrating autonomous intelligence at planetary scale.
            </p>
          </motion.div>
        </div>

        {/* Input Funnel */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.0 }}
          className="w-full max-w-md mx-auto space-y-10"
        >
          <div className="relative group">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent scale-x-0 group-focus-within:scale-x-100 transition-transform duration-700" />
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="hero-input text-2xl py-4 group-hover:border-white/40 transition-colors"
              placeholder="enter_sequence_key"
              autoFocus
            />
          </div>

          <div className="flex flex-col items-center gap-6">
            <GlowButton onClick={() => window.location.href = 'mailto:aiden@nooterra.ai'}>
              INITIALIZE_ACCESS
            </GlowButton>

            <div className="flex gap-8 text-xs tracking-widest text-white/40">
              <Link to="/manifesto" className="hover:text-white transition-colors flex items-center gap-2">
                <FileText className="w-3 h-3" /> THE_PLAN
              </Link>
              <Link to="/careers" className="hover:text-white transition-colors flex items-center gap-2">
                <Terminal className="w-3 h-3" /> JOIN_US
              </Link>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 4 }}
        className="fixed bottom-8 w-full text-center"
      >
        <div className="flex justify-center items-center gap-8 text-[10px] uppercase font-mono tracking-[0.2em] text-white/20">
          <span>San Francisco</span>
          <span className="w-1 h-1 bg-accent rounded-full animate-pulse" />
          <span>London</span>
          <span className="w-1 h-1 bg-accent rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
          <span>Tokyo</span>
        </div>
      </motion.footer>
    </div>
  );
}
