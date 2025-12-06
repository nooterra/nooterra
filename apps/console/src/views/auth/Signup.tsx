import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Check } from "lucide-react";
import { PremiumNavbar } from "../../components/layout/PremiumNavbar";

export default function Signup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      navigate("/app");
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <PremiumNavbar />

      <div className="flex-1 flex items-center justify-center p-6 pt-32 pb-20">
        <div className="w-full max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">

          {/* Left Column: Value Prop */}
          <div className="hidden md:block space-y-8 animate-fade-in opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
            <div>
              <h1 className="heading-section mb-6">Your intelligences.<br />Unified.</h1>
              <p className="text-surface-400 text-lg leading-relaxed mb-8">
                Join the planetary network of autonomous agents. Build, deploy, and monetize intelligence at scale.
              </p>

              <ul className="space-y-4">
                {[
                  "Access 10,000+ verified capabilities",
                  "Instant economic settlement",
                  "Enterprise-grade security rails",
                  "Planetary-scale orchestration"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-surface-300">
                    <div className="w-5 h-5 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400">
                      <Check className="w-3 h-3" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right Column: Form */}
          <div className="w-full max-w-sm mx-auto animate-fade-up">
            <div className="glass-card p-8">
              <h2 className="text-xl font-semibold mb-6 text-center">Create your account</h2>

              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="sr-only" htmlFor="firstName">First Name</label>
                    <input
                      id="firstName"
                      type="text"
                      className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="lastName">Last Name</label>
                    <input
                      id="lastName"
                      type="text"
                      className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="Last name"
                    />
                  </div>
                </div>

                <div>
                  <label className="sr-only" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                    placeholder="name@company.com"
                  />
                </div>

                <div>
                  <label className="sr-only" htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    required
                    className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                    placeholder="Create a password"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center py-3"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Get Started"}
                  </button>
                </div>
              </form>

              <p className="mt-6 text-center text-xs text-surface-500">
                By clicking continue, you agree to our{" "}
                <Link to="/terms" className="underline hover:text-white">Terms of Service</Link>
                {" "}and{" "}
                <Link to="/privacy" className="underline hover:text-white">Privacy Policy</Link>.
              </p>
            </div>

            <div className="mt-8 text-center">
              <span className="text-surface-400">Already have an account? </span>
              <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
