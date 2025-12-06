import React from 'react';
import { Link } from 'react-router-dom';
import { Github, Twitter, Linkedin, ArrowUpRight } from 'lucide-react';

export const PremiumFooter: React.FC = () => {
    return (
        <footer className="bg-black border-t border-white/10 pt-20 pb-10">
            <div className="container-width">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 mb-20">
                    <div className="col-span-2 lg:col-span-2">
                        <Link to="/" className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-lg">
                                N
                            </div>
                            <span className="text-xl font-semibold tracking-tight text-white">
                                Nooterra
                            </span>
                        </Link>
                        <p className="text-surface-400 text-sm leading-relaxed max-w-sm mb-6">
                            The coordination protocol for the agent economy.
                            Connecting intelligence at planetary scale with verifiable trust and economic incentives.
                        </p>
                        <div className="flex gap-4">
                            <SocialLink href="https://github.com/nooterra" icon={<Github className="w-5 h-5" />} />
                            <SocialLink href="https://twitter.com/nooterra" icon={<Twitter className="w-5 h-5" />} />
                            <SocialLink href="https://linkedin.com/company/nooterra" icon={<Linkedin className="w-5 h-5" />} />
                        </div>
                    </div>

                    <div>
                        <h4 className="text-white font-medium mb-6">Product</h4>
                        <ul className="space-y-4">
                            <FooterLink to="/marketplace">Marketplace</FooterLink>
                            <FooterLink to="/network">Network Status</FooterLink>
                            <FooterLink to="/protocols">Protocols</FooterLink>
                            <FooterLink to="/pricing">Pricing</FooterLink>
                        </ul>
                    </div>

                    <div>
                        <h4 className="text-white font-medium mb-6">Developers</h4>
                        <ul className="space-y-4">
                            <FooterLink to="/docs">Documentation</FooterLink>
                            <FooterLink to="/api">API Reference</FooterLink>
                            <FooterLink to="/sdk">SDKs</FooterLink>
                            <FooterLink to="/bounties">Bounties</FooterLink>
                        </ul>
                    </div>

                    <div>
                        <h4 className="text-white font-medium mb-6">Company</h4>
                        <ul className="space-y-4">
                            <FooterLink to="/about">About</FooterLink>
                            <FooterLink to="/blog">Blog</FooterLink>
                            <FooterLink to="/careers">Careers</FooterLink>
                            <FooterLink to="/contact">Contact</FooterLink>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-surface-500 text-sm">
                        © {new Date().getFullYear()} Nooterra Inc. All rights reserved.
                    </p>
                    <div className="flex gap-8">
                        <Link to="/privacy" className="text-surface-500 hover:text-white text-sm transition-colors">Privacy Policy</Link>
                        <Link to="/terms" className="text-surface-500 hover:text-white text-sm transition-colors">Terms of Service</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};

const FooterLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
    <li>
        <Link to={to} className="text-surface-400 hover:text-white text-sm transition-colors flex items-center group">
            {children}
        </Link>
    </li>
);

const SocialLink: React.FC<{ href: string; icon: React.ReactNode }> = ({ href, icon }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 rounded-full bg-surface-900 border border-white/10 flex items-center justify-center text-surface-400 hover:text-white hover:border-white/30 transition-all"
    >
        {icon}
    </a>
);
