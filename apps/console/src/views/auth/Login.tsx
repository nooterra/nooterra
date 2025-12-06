import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { PremiumNavbar } from "../../components/layout/PremiumNavbar";

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate login
    setTimeout(() => {
      setLoading(false);
      navigate("/app");
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <PremiumNavbar />

      <div className="flex-1 flex items-center justify-center p-6 pt-24">
        <div className="w-full max-w-sm mx-auto animate-fade-in">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Welcome back</h1>
            <p className="text-surface-400">Sign in to your account</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="sr-only" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="Email address"
              />
            </div>

            <div>
              <label className="sr-only" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="Password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            <Link to="/forgot-password" classNme="text-sm text-surface-400 hover:text-white transition-colors block">
              Forgot password?
            </Link>
            <div className="text-sm text-surface-400">
              Don't have an account?{" "}
              <Link to="/signup" className="text-primary-400 hover:text-primary-300 font-medium">
                Create one
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
