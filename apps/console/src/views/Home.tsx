import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hero3D } from '../components/ui/Hero3D';
import { TextReveal } from '../components/ui/TextReveal';
import { GlowButton } from '../components/ui/GlowButton';
import { motion } from 'framer-motion';

export default function Home() {
  const [email, setEmail] = useState('');

  return (
    <div className="min-h-screen bg-transparent relative overflow-hidden flex flex-col items-center justify-center text-center px-4">
      {/* 3D Background */}
      <div className="fixed inset-0 z-0">
        <Hero3D />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-4xl mx-auto space-y-12">
        <div className="space-y-4">
          {/* Cryptic Header */}
          <div className="h-20 flex items-center justify-center">
            <TextReveal
              text="THE PROTOCOL."
              className="text-5xl md:text-7xl font-bold font-sans tracking-tight text-white glow-text"
              delay={0.5}
            />
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.5, duration: 1 }}
            className="text-lg md:text-xl text-foreground/60 font-mono tracking-wide max-w-2xl mx-auto"
          >
            We are building the operating system for the post-labor economy.
          </motion.p>
        </div>

        {/* Input Funnel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.5 }}
          className="w-full max-w-md mx-auto space-y-8"
        >
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="hero-input"
            placeholder="enter_sequence_key"
            autoFocus
          />

          <div>
            <GlowButton>INITIALIZE</GlowButton>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 4 }}
        className="fixed bottom-8 w-full text-center text-[10px] uppercase font-mono tracking-[0.2em] text-white/30"
      >
        <span className="mx-4">San Francisco</span>
        <span className="mx-4">London</span>
        <span className="mx-4">Tokyo</span>
      </motion.footer>

      {/* Hidden Nav */}
      <div className="fixed top-8 right-8 mix-blend-difference">
        <Link to="/careers" className="text-xs font-mono text-white/50 hover:text-white transition-opacity">
           // JOBS
        </Link>
      </div>
    </div>
  );
}
