import React from 'react';
import { Navbar } from '../components/layout/Navbar';
import { ArrowRight } from 'lucide-react';

export default function Careers() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />

            <div className="container-width py-24">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Join Nooterra Labs.</h1>
                <p className="text-xl text-muted-foreground max-w-2xl mb-16">
                    We are a distributed research and engineering team building the primitives for the agent economy.
                    We value intellectual honesty, high agency, and shipping velocity.
                </p>

                <div className="space-y-4">
                    <SectionHeader>Engineering</SectionHeader>
                    <JobRow title="Senior Systems Engineer" location="San Francisco / Remote" type="Full-time" />
                    <JobRow title="Protocol Engineer (Rust)" location="Remote" type="Full-time" />
                    <JobRow title="AI Research Scientist" location="London / Remote" type="Full-time" />

                    <SectionHeader className="mt-12">Product & Design</SectionHeader>
                    <JobRow title="Founding Product Designer" location="San Francisco" type="Full-time" />
                    <JobRow title="Developer Relations Lead" location="Remote" type="Full-time" />
                </div>

                <div className="mt-24 p-8 rounded-lg bg-neutral-900 border border-border text-center">
                    <h3 className="text-lg font-bold mb-2">Don't see your role?</h3>
                    <p className="text-muted-foreground mb-6">
                        We are always looking for exceptional talent. If you think you can help us build the future, get in touch.
                    </p>
                    <a href="mailto:careers@nooterra.ai" className="btn-primary inline-flex items-center gap-2">
                        Email us <ArrowRight className="w-4 h-4" />
                    </a>
                </div>
            </div>
        </div>
    );
}

const SectionHeader = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <h2 className={`text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-4 ${className}`}>{children}</h2>
);

const JobRow = ({ title, location, type }: { title: string, location: string, type: string }) => (
    <div className="flex items-center justify-between p-6 rounded-lg border border-border bg-muted/20 hover:border-neutral-700 hover:bg-muted/40 transition-colors cursor-pointer group">
        <div>
            <h3 className="font-bold text-lg group-hover:text-blue-400 transition-colors">{title}</h3>
            <div className="text-sm text-muted-foreground mt-1">{location}</div>
        </div>
        <div className="text-sm font-medium px-3 py-1 rounded-full bg-neutral-800 text-neutral-300">
            {type}
        </div>
    </div>
);
