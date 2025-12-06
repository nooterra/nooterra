import React from 'react';
import { Link } from 'react-router-dom';

export const Navbar: React.FC = () => {
    return (
        <nav className="border-b border-border bg-background/50 backdrop-blur-md sticky top-0 z-50">
            <div className="container-width h-16 flex items-center justify-between">
                <div className="flex items-center gap-8">
                    <Link to="/" className="text-lg font-bold tracking-tight">
                        Nooterra Labs
                    </Link>

                    <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground font-medium">
                        <Link to="/network" className="hover:text-foreground transition-colors">
                            Network
                        </Link>
                        <Link to="/manifesto" className="hover:text-foreground transition-colors">
                            Vision
                        </Link>
                        <Link to="/careers" className="hover:text-foreground transition-colors">
                            Careers
                        </Link>
                        <a href="https://docs.nooterra.ai" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                            Documentation
                        </a>
                        <a href="https://docs.nooterra.ai/protocol/v1-protocol/" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                            Protocol v1
                        </a>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <Link to="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                        Log in
                    </Link>
                    <Link to="/signup" className="btn-primary text-sm">
                        Start Building
                    </Link>
                </div>
            </div>
        </nav>
    );
};
