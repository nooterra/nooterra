"use client";
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronDown } from "lucide-react";

const navLinks = [
  { 
    label: "Products", 
    href: "#",
    submenu: [
      { label: "Playground", href: "/playground", desc: "Test AI agent coordination" },
      { label: "Marketplace", href: "/marketplace", desc: "Discover & deploy agents" },
      { label: "Network", href: "/network", desc: "Live protocol metrics" },
    ]
  },
  { 
    label: "Developers", 
    href: "#",
    submenu: [
      { label: "Documentation", href: "/docs", desc: "Guides & API reference" },
      { label: "Deploy Agent", href: "/dev/deploy", desc: "Ship in one click" },
      { label: "Integrations", href: "/dev/integrations", desc: "Connect existing tools" },
    ]
  },
  { label: "Pricing", href: "/pricing" },
  { label: "Enterprise", href: "/enterprise" },
];

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setActiveDropdown(null);
  }, [location.pathname]);

  return (
    <>
      <motion.nav
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          isScrolled
            ? "bg-black/80 backdrop-blur-2xl border-b border-white/5 shadow-2xl shadow-black/20"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 group">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-violet-500 rounded-lg blur-md opacity-50 group-hover:opacity-75 transition-opacity" />
                <img
                  src="/logo.png"
                  alt="Nooterra"
                  className="relative h-8 w-8 rounded-lg"
                />
              </div>
              <span className="text-xl font-semibold text-white tracking-tight">
                Nooterra
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              {navLinks.map((link) => (
                <div
                  key={link.label}
                  className="relative"
                  onMouseEnter={() => link.submenu && setActiveDropdown(link.label)}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  {link.submenu ? (
                    <button className="flex items-center gap-1.5 px-4 py-2 text-sm text-neutral-300 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                      {link.label}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === link.label ? "rotate-180" : ""}`} />
                    </button>
                  ) : (
                    <Link
                      to={link.href}
                      className="px-4 py-2 text-sm text-neutral-300 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                    >
                      {link.label}
                    </Link>
                  )}
                  
                  {/* Dropdown */}
                  <AnimatePresence>
                    {link.submenu && activeDropdown === link.label && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full left-0 pt-2"
                      >
                        <div className="bg-neutral-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-2 min-w-[240px] shadow-2xl shadow-black/50">
                          {link.submenu.map((item) => (
                            <Link
                              key={item.label}
                              to={item.href}
                              className="flex flex-col gap-0.5 px-4 py-3 rounded-xl hover:bg-white/5 transition-colors group"
                            >
                              <span className="text-sm font-medium text-white group-hover:text-cyan-400 transition-colors">
                                {item.label}
                              </span>
                              <span className="text-xs text-neutral-500">
                                {item.desc}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            {/* Auth Buttons */}
            <div className="hidden lg:flex items-center gap-3">
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-full bg-white text-black hover:bg-neutral-200 transition-colors"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              {mobileOpen ? (
                <X className="w-6 h-6 text-white" />
              ) : (
                <Menu className="w-6 h-6 text-white" />
              )}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
          >
            <div className="absolute inset-0 bg-black/90 backdrop-blur-2xl" />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="absolute right-0 top-0 h-full w-full max-w-sm bg-neutral-950 border-l border-white/10 p-6 pt-24"
            >
              <div className="flex flex-col gap-2">
                {navLinks.map((link) => (
                  <div key={link.label}>
                    {link.submenu ? (
                      <div className="py-2">
                        <span className="text-xs uppercase tracking-wider text-neutral-500 font-medium">
                          {link.label}
                        </span>
                        <div className="mt-2 flex flex-col gap-1">
                          {link.submenu.map((item) => (
                            <Link
                              key={item.label}
                              to={item.href}
                              className="px-3 py-2 text-neutral-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Link
                        to={link.href}
                        className="block px-3 py-3 text-lg text-white hover:bg-white/5 rounded-lg transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-3">
                <Link
                  to="/login"
                  className="w-full py-3 text-center text-white border border-white/20 rounded-xl hover:bg-white/5 transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="w-full py-3 text-center text-white bg-gradient-to-r from-cyan-500 to-violet-500 rounded-xl font-medium"
                >
                  Get Started Free
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
