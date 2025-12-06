import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronRight } from 'lucide-react';

export const PremiumNavbar: React.FC = () => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const location = useLocation();

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const navLinks = [
        { name: 'Product', path: '/#features' },
        { name: 'Network', path: '/network' },
        { name: 'Developers', path: '/dev' },
        { name: 'Pricing', path: '/pricing' },
    ];

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${isScrolled
                    ? 'bg-black/80 backdrop-blur-xl border-white/10 py-3'
                    : 'bg-transparent border-transparent py-5'
                }`}
        >
            <div className="container-width flex items-center justify-between">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-2 group">
                    <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-lg">
                        N
                    </div>
                    <span className="text-xl font-semibold tracking-tight text-white group-hover:text-primary-400 transition-colors">
                        Nooterra
                    </span>
                </Link>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link
                            key={link.name}
                            to={link.path}
                            className="text-sm font-medium text-surface-400 hover:text-white transition-colors"
                        >
                            {link.name}
                        </Link>
                    ))}
                </div>

                {/* CTA */}
                <div className="hidden md:flex items-center gap-4">
                    <Link
                        to="/login"
                        className="text-sm font-medium text-white hover:text-primary-400 transition-colors"
                    >
                        Sign in
                    </Link>
                    <Link
                        to="/signup"
                        className="btn-primary"
                    >
                        Get Started <ChevronRight className="w-4 h-4 ml-1" />
                    </Link>
                </div>

                {/* Mobile Menu Toggle */}
                <button
                    className="md:hidden text-white"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    {mobileMenuOpen ? <X /> : <Menu />}
                </button>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="absolute top-full left-0 right-0 bg-black border-b border-white/10 p-6 md:hidden flex flex-col gap-4 animate-fade-in shadow-2xl">
                    {navLinks.map((link) => (
                        <Link
                            key={link.name}
                            to={link.path}
                            className="text-lg font-medium text-surface-300 hover:text-white"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {link.name}
                        </Link>
                    ))}
                    <div className="h-px bg-white/10 my-2" />
                    <Link
                        to="/login"
                        className="text-lg font-medium text-white"
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        Sign in
                    </Link>
                    <Link
                        to="/signup"
                        className="btn-primary w-full"
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        Get Started
                    </Link>
                </div>
            )}
        </nav>
    );
};
