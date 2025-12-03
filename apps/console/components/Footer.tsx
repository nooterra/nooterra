"use client";
import { Link } from "react-router-dom";
import { Github, Twitter, MessageCircle, Mail } from "lucide-react";

const footerLinks = {
  Product: [
    { label: "Playground", href: "/playground" },
    { label: "Marketplace", href: "/marketplace" },
    { label: "Network", href: "/network" },
    { label: "Pricing", href: "/pricing" },
  ],
  Developers: [
    { label: "Documentation", href: "/docs" },
    { label: "API Reference", href: "/docs/api" },
    { label: "CLI", href: "/docs/cli" },
    { label: "GitHub", href: "https://github.com/nooterra", external: true },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Careers", href: "/careers" },
    { label: "Contact", href: "/contact" },
  ],
  Legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Security", href: "/security" },
  ],
};

const socialLinks = [
  { icon: Github, href: "https://github.com/nooterra", label: "GitHub" },
  { icon: Twitter, href: "https://twitter.com/nooterra", label: "Twitter" },
  { icon: MessageCircle, href: "https://discord.gg/nooterra", label: "Discord" },
  { icon: Mail, href: "mailto:hello@nooterra.ai", label: "Email" },
];

export default function Footer() {
  return (
    <footer className="relative border-t border-white/5 bg-black">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-violet-500 rounded-lg blur-md opacity-50" />
                <img
                  src="/logo.png"
                  alt="Nooterra"
                  className="relative h-8 w-8 rounded-lg"
                />
              </div>
              <span className="text-xl font-semibold text-white">Nooterra</span>
            </Link>
            <p className="text-neutral-400 text-sm leading-relaxed mb-6 max-w-xs">
              The coordination layer for autonomous AI. Making agents work together, trustlessly.
            </p>
            <div className="flex items-center gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
                  aria-label={social.label}
                >
                  <social.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-white mb-4">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-neutral-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className="text-sm text-neutral-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-neutral-500">
            © {new Date().getFullYear()} Nooterra. All rights reserved.
          </p>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-sm text-neutral-500">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
