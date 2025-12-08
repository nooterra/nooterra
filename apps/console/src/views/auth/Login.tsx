import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ArrowRight, Wallet } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'https://coord.nooterra.ai';

// Google icon SVG component
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Handle OAuth redirect with tokens
  useEffect(() => {
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');
    const oauthError = searchParams.get('error');

    if (oauthError) {
      setError(`Login failed: ${oauthError.replace(/_/g, ' ')}`);
      // Clean URL
      window.history.replaceState({}, '', '/login');
      return;
    }

    if (token && refresh) {
      // OAuth success - store tokens and redirect
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refresh);

      const isNew = searchParams.get('new') === 'true';
      if (isNew) {
        navigate('/onboarding');
      } else {
        navigate('/user/dashboard');
      }
    }
  }, [searchParams, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid credentials');
      }

      // Store tokens
      localStorage.setItem('token', data.accessToken || data.token);
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      navigate("/user/dashboard");
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    // Redirect to backend OAuth endpoint
    window.location.href = `${API_URL}/auth/google`;
  };

  return (
    <div className="min-h-screen bg-[#030308] overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 grid-bg opacity-30" />
      <div className="hero-glow hero-glow-1" style={{ top: '-30%', right: '-20%', opacity: 0.2 }} />
      <div className="hero-glow hero-glow-2" style={{ bottom: '-30%', left: '-20%', opacity: 0.2 }} />

      {/* Navbar */}
      <nav className="nav-glass sticky top-0 z-50">
        <div className="container-width h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="logo-mark">N</div>
            <span className="text-lg font-semibold tracking-tight">Nooterra</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/signup" className="btn-primary text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-64px)] p-6">
        <div className="w-full max-w-md mx-auto animate-slide-up">
          <div className="glass-card-elevated p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="heading-lg mb-2">Welcome back</h1>
              <p className="text-[--text-secondary]">Sign in to continue building</p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Google Sign In - Primary Option */}
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full py-4 px-6 rounded-xl bg-white text-gray-900 font-medium flex items-center justify-center gap-3 hover:bg-gray-100 transition-all duration-200 mb-6"
            >
              {googleLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>

            {/* Divider */}
            <div className="my-6 flex items-center gap-4">
              <div className="flex-1 h-px bg-[--glass-border]" />
              <span className="text-xs text-[--text-muted] uppercase tracking-wider">or use email</span>
              <div className="flex-1 h-px bg-[--glass-border]" />
            </div>

            {/* Email Form */}
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="sr-only" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-glass"
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
                  className="input-glass"
                  placeholder="Password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-secondary w-full py-4 text-base flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In with Email
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            {/* Wallet Connect */}
            <button className="mt-4 btn-ghost w-full py-3 flex items-center justify-center gap-3 text-sm">
              <Wallet className="w-4 h-4" />
              Continue with Wallet
            </button>

            {/* Links */}
            <div className="mt-6 text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-[--text-muted] hover:text-white transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <div className="mt-8 text-center">
            <span className="text-[--text-muted]">Don't have an account? </span>
            <Link to="/signup" className="text-[--accent-1] hover:text-[--accent-2] font-medium transition-colors">
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

