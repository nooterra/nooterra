import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Github, Mail, User, Code, Building2, Check } from "lucide-react";

type Role = "user" | "developer" | "organization";

const roles: { id: Role; title: string; desc: string; icon: React.ReactNode; features: string[] }[] = [
  {
    id: "user",
    title: "User",
    desc: "Use AI agents through a powerful chat interface",
    icon: <User className="w-6 h-6" />,
    features: ["Conversational AI interface", "Connect your own models", "Usage tracking & history"],
  },
  {
    id: "developer",
    title: "Developer",
    desc: "Build & monetize AI agents on the network",
    icon: <Code className="w-6 h-6" />,
    features: ["Deploy unlimited agents", "SDK & API access", "Earnings dashboard"],
  },
  {
    id: "organization",
    title: "Organization",
    desc: "Orchestrate AI workflows at enterprise scale",
    icon: <Building2 className="w-6 h-6" />,
    features: ["Visual workflow builder", "Team management", "Advanced analytics"],
  },
];

export default function Signup() {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [role, setRole] = React.useState<Role>("user");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";
      const res = await fetch(`${coordUrl}/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, role }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Signup failed");
      }

      const data = await res.json();
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Redirect based on role
      if (role === "developer") {
        navigate("/dev");
      } else if (role === "organization") {
        navigate("/org");
      } else {
        navigate("/app");
      }
    } catch (err: any) {
      setError(err.message || "Signup failed");
      // Demo mode
      if (email && password) {
        localStorage.setItem("token", "demo-token");
        localStorage.setItem("user", JSON.stringify({ email, role, name: name || email.split("@")[0] }));
        if (role === "developer") {
          navigate("/dev");
        } else if (role === "organization") {
          navigate("/org");
        } else {
          navigate("/app");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050508] flex items-center justify-center px-4 py-12">
      {/* Background */}
      <div
        className="fixed inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 50% 0%, rgba(79, 124, 255, 0.12) 0%, transparent 50%),
            radial-gradient(ellipse 40% 30% at 20% 80%, rgba(0, 212, 255, 0.08) 0%, transparent 40%),
            #050508
          `,
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-2xl"
      >
        {/* Logo */}
        <Link to="/" className="flex justify-center mb-8">
          <img src="/logo.svg" alt="Nooterra" className="w-12 h-12" />
        </Link>

        <div className="glass-panel rounded-2xl p-8">
          {step === 1 ? (
            <>
              <h1 className="text-2xl font-bold text-white text-center mb-2">Join Nooterra</h1>
              <p className="text-[#707090] text-center mb-8">How will you use the network?</p>

              <div className="grid md:grid-cols-3 gap-4 mb-8">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    className={`relative p-5 rounded-xl border text-left transition-all ${
                      role === r.id
                        ? "bg-[#4f7cff]/10 border-[#4f7cff]/50"
                        : "bg-[#0a0a12] border-[#4f7cff]/10 hover:border-[#4f7cff]/30"
                    }`}
                  >
                    {role === r.id && (
                      <div className="absolute top-3 right-3 w-5 h-5 bg-[#4f7cff] rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                      role === r.id ? "bg-[#4f7cff]/20 text-[#4f7cff]" : "bg-[#4f7cff]/10 text-[#606080]"
                    }`}>
                      {r.icon}
                    </div>
                    <h3 className="font-semibold text-white mb-1">{r.title}</h3>
                    <p className="text-xs text-[#707090] mb-3">{r.desc}</p>
                    <ul className="space-y-1">
                      {r.features.map((f, i) => (
                        <li key={i} className="text-xs text-[#505060] flex items-center gap-2">
                          <span className="w-1 h-1 bg-[#4f7cff] rounded-full" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>

              <button onClick={() => setStep(2)} className="w-full btn-neural justify-center">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="text-[#707090] hover:text-white text-sm mb-6">
                ← Back
              </button>

              <h1 className="text-2xl font-bold text-white text-center mb-2">Create your account</h1>
              <p className="text-[#707090] text-center mb-8">
                Signing up as <span className="text-[#4f7cff]">{roles.find(r => r.id === role)?.title}</span>
              </p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-6 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm text-[#909098] mb-2">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#4f7cff]/50 focus:outline-none focus:ring-1 focus:ring-[#4f7cff]/30 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#909098] mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#4f7cff]/50 focus:outline-none focus:ring-1 focus:ring-[#4f7cff]/30 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#909098] mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#4f7cff]/50 focus:outline-none focus:ring-1 focus:ring-[#4f7cff]/30 transition-all"
                    required
                    minLength={8}
                  />
                  <p className="text-xs text-[#505060] mt-1">Minimum 8 characters</p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-neural justify-center disabled:opacity-50"
                >
                  {loading ? "Creating account..." : "Create Account"} <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#4f7cff]/10" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[#0f0f18] px-4 text-[#606080]">or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button className="flex items-center justify-center gap-2 px-4 py-3 bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg text-[#909098] hover:text-white hover:border-[#4f7cff]/40 transition-all text-sm">
                  <Github className="w-4 h-4" /> GitHub
                </button>
                <button className="flex items-center justify-center gap-2 px-4 py-3 bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg text-[#909098] hover:text-white hover:border-[#4f7cff]/40 transition-all text-sm">
                  <Mail className="w-4 h-4" /> Google
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[#606080] text-sm mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-[#4f7cff] hover:text-[#00d4ff]">
            Sign in
          </Link>
        </p>

        <p className="text-center text-[#404050] text-xs mt-4">
          By signing up, you agree to our <Link to="/terms" className="underline">Terms</Link> and{" "}
          <Link to="/privacy" className="underline">Privacy Policy</Link>
        </p>
      </motion.div>
    </div>
  );
}

