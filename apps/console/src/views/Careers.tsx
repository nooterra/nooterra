import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Careers() {
    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-12 font-mono selection:bg-white selection:text-black">
            <nav className="fixed top-6 left-6 z-50 mix-blend-difference">
                <Link to="/" className="text-sm font-bold uppercase tracking-widest hover:underline decoration-2 underline-offset-4">
                    {'<'} RETURN_ROOT
                </Link>
            </nav>

            <div className="max-w-7xl mx-auto mt-24 md:mt-40">
                <header className="mb-24">
                    <h1 className="text-[10vw] font-black uppercase tracking-tighter leading-[0.8] mb-4">
                        Join The<br />Machine
                    </h1>
                    <p className="text-xl md:text-2xl max-w-2xl mt-8 text-white/60">
                        We are looking for the top 0.01% of systems engineers.
                        <br />
                        <span className="text-white">If you have to ask, you are not ready.</span>
                    </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-0 border-t border-white/20">
                    <Job
                        title="Founding Engineer (Systems)"
                        id="FE_SYS_01"
                        desc="Rust / Low-Level / P2P"
                    />
                    <Job
                        title="Founding Engineer (AI)"
                        id="FE_AI_01"
                        desc="Reasoning / Eval / PyTorch"
                    />
                    <Job
                        title="Visual Architect"
                        id="DS_VIS_01"
                        desc="WebGL / Brutalism / UI"
                    />
                </div>

                <div className="mt-32 p-12 bg-white text-black text-center">
                    <div className="text-sm font-bold uppercase tracking-widest mb-4">
               // HOW_TO_APPLY
                    </div>
                    <div className="text-2xl md:text-4xl font-black uppercase mb-8">
                        Send your GitHub. Nothing else.
                    </div>
                    <a href="mailto:deploy@nooterra.ai" className="inline-block border-2 border-black px-8 py-3 text-sm font-bold uppercase hover:bg-black hover:text-white transition-colors duration-0">
                        deploy@nooterra.ai
                    </a>
                </div>
            </div>
        </div>
    );
}

const Job = ({ title, id, desc }: { title: string, id: string, desc: string }) => (
    <div className="border-b border-white/20 md:border-b-0 md:border-r border-white/20 last:border-r-0 p-8 md:p-12 hover:bg-white hover:text-black transition-colors duration-0 cursor-crosshair group">
        <div className="text-[10px] uppercase tracking-widest opacity-50 mb-4 group-hover:opacity-100">
            Job_ID: {id}
        </div>
        <h3 className="text-2xl font-bold uppercase mb-4 leading-tight">{title}</h3>
        <div className="text-sm font-mono opacity-60 group-hover:opacity-100">
            {desc}
        </div>
    </div>
);
