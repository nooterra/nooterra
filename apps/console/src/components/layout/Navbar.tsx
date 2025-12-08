import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown } from 'lucide-react';

export const Navbar: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <nav className="nav-glass sticky top-0 z-50">
            <div className="container-width h-16 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-10">
                    <Link to="/" className="flex items-center gap-3">
                        <div className="logo-mark">N</div>
                        <span className="text-lg font-semibold tracking-tight">Nooterra</span>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden lg:flex items-center gap-8">
                        <NavLink to="/network" active={isActive('/network')}>Network</NavLink>
                        <NavLink to="/manifesto" active={isActive('/manifesto')}>Vision</NavLink>

                        {/* Developers Dropdown */}
                        <div className="relative group">
                            <button className="flex items-center gap-1 text-sm font-medium text-[--text-secondary] hover:text-white transition-colors py-2">
                                Developers
                                <ChevronDown className="w-4 h-4 transition-transform group-hover:rotate-180" />
                            </button>
                            <div className="absolute top-full left-0 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                <div className="glass-card p-2 min-w-[200px] shadow-2xl">
                                    <DropdownLink href="https://docs.nooterra.ai" external>Documentation</DropdownLink>
                                    <DropdownLink href="https://docs.nooterra.ai/protocol/v1-protocol/">Protocol v1</DropdownLink>
                                    <DropdownLink href="https://docs.nooterra.ai/sdk/typescript/">TypeScript SDK</DropdownLink>
                                    <DropdownLink href="https://docs.nooterra.ai/sdk/python/">Python SDK</DropdownLink>
                                    <DropdownLink href="https://github.com/nooterra" external>GitHub</DropdownLink>
                                </div>
                            </div>
                        </div>

                        <NavLink to="/careers" active={isActive('/careers')}>Careers</NavLink>
                    </div>
                </div>

                {/* Desktop CTA */}
                <div className="hidden lg:flex items-center gap-4">
                    <Link to="/login" className="btn-ghost text-sm">Log in</Link>
                    <Link to="/signup" className="btn-primary text-sm">
                        Get Started
                    </Link>
                </div>

                {/* Mobile Menu Button */}
                <button
                    className="lg:hidden p-2 text-[--text-secondary] hover:text-white"
                    onClick={() => setMobileOpen(!mobileOpen)}
                >
                    {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile Menu */}
            {mobileOpen && (
                <div className="lg:hidden border-t border-[--glass-border] bg-[#030308]">
                    <div className="container-width py-6 space-y-4">
                        <MobileNavLink to="/network" onClick={() => setMobileOpen(false)}>Network</MobileNavLink>
                        <MobileNavLink to="/manifesto" onClick={() => setMobileOpen(false)}>Vision</MobileNavLink>
                        <MobileNavLink to="/careers" onClick={() => setMobileOpen(false)}>Careers</MobileNavLink>
                        <a
                            href="https://docs.nooterra.ai"
                            target="_blank"
                            rel="noreferrer"
                            className="block py-2 text-[--text-secondary] hover:text-white transition-colors"
                        >
                            Documentation
                        </a>
                        <div className="pt-4 space-y-3">
                            <Link to="/login" className="block btn-secondary w-full text-center" onClick={() => setMobileOpen(false)}>
                                Log in
                            </Link>
                            <Link to="/signup" className="block btn-primary w-full text-center" onClick={() => setMobileOpen(false)}>
                                Get Started
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};

const NavLink = ({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) => (
    <Link
        to={to}
        className={`text-sm font-medium transition-colors ${active ? 'text-white' : 'text-[--text-secondary] hover:text-white'
            }`}
    >
        {children}
    </Link>
);

const DropdownLink = ({
    href,
    external,
    children
}: {
    href: string;
    external?: boolean;
    children: React.ReactNode
}) => (
    <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="block px-4 py-2 rounded-lg text-sm text-[--text-secondary] hover:text-white hover:bg-[--glass-2] transition-colors"
    >
        {children}
    </a>
);

const MobileNavLink = ({
    to,
    onClick,
    children
}: {
    to: string;
    onClick: () => void;
    children: React.ReactNode
}) => (
    <Link
        to={to}
        onClick={onClick}
        className="block py-2 text-lg font-medium text-[--text-secondary] hover:text-white transition-colors"
    >
        {children}
    </Link>
);

export default Navbar;
