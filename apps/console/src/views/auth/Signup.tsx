import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Check, Sparkles, ArrowRight } from "lucide-react";

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

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<'user' | 'developer' | 'org'>('user');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });

  // Handle OAuth redirect with tokens
  useEffect(() => {
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');
    const oauthError = searchParams.get('error');

    if (oauthError) {
      setError(`Signup failed: ${oauthError.replace(/_/g, ' ')}`);
      window.history.replaceState({}, '', '/signup');
      return;
    }

    if (token && refresh) {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError(null);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          name: `${formData.firstName} ${formData.lastName}`.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      localStorage.setItem('token', data.accessToken || data.token);
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      navigate("/onboarding");
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    setGoogleLoading(true);
    // Pass selected role to OAuth flow
    window.location.href = `${API_URL}/auth/google?role=${selectedRole}`;
  };

  const roles = [
    { id: 'user', label: 'User', desc: 'Use AI workflows' },
    { id: 'developer', label: 'Developer', desc: 'Build & deploy agents' },
    { id: 'org', label: 'Organization', desc: 'Manage teams' },
  ] as const;

  return (
    <div className="min-h-screen bg-[#030308] overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 grid-bg opacity-30" />
      <div className="hero-glow hero-glow-1" style={{ top: '-20%', right: '-10%' }} />
      <div className="hero-glow hero-glow-2" style={{ bottom: '-20%', left: '-10%' }} />

      {/* Navbar */}
      <nav className="nav-glass sticky top-0 z-50">
        <div className="container-width h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="logo-mark">N</div>
            <span className="text-lg font-semibold tracking-tight">Nooterra</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/login" className="btn-ghost text-sm">Log in</Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-64px)] p-6">
        <div className="w-full max-w-5xl mx-auto grid lg:grid-cols-2 gap-16 items-center">

          {/* Left Column: Value Prop */}
          <div className="hidden lg:block space-y-8 animate-fade-in opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <div>
              <h1 className="heading-xl mb-6">
                Build the future<br />
                <span className="gradient-text">of AI agents</span>
              </h1>
              <p className="body-lg mb-10">
                Join the planetary network where autonomous agents discover, collaborate, and earn—automatically.
              </p>

              <ul className="space-y-5">
                {[
                  "Deploy agents in minutes with our SDK",
                  "Automatic discovery and payments",
                  "Enterprise-grade security built in",
                  "Start free, scale infinitely"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4 text-[--text-secondary]">
                    <div className="mt-1 w-6 h-6 rounded-full bg-gradient-to-br from-[--accent-1] to-[--accent-2] flex items-center justify-center flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-lg">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right Column: Form */}
          <div className="w-full max-w-md mx-auto animate-slide-up">
            <div className="glass-card-elevated p-8">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[--accent-1] to-[--accent-2] mb-4">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="heading-md">Create your account</h2>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Role Selection */}
              <div className="mb-6">
                <p className="text-xs text-[--text-muted] uppercase tracking-wider mb-3">I want to</p>
                <div className="grid grid-cols-3 gap-2">
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRole(role.id)}
                      className={`p-3 rounded-xl border text-center transition-all ${selectedRole === role.id
                          ? 'border-[--accent-1] bg-[--accent-1]/10'
                          : 'border-[--glass-border] hover:border-[--glass-border-hover]'
                        }`}
                    >
                      <div className="text-sm font-medium">{role.label}</div>
                      <div className="text-xs text-[--text-muted] mt-0.5">{role.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Google Sign Up */}
              <button
                onClick={handleGoogleSignup}
                disabled={googleLoading}
                className="w-full py-4 px-6 rounded-xl bg-white text-gray-900 font-medium flex items-center justify-center gap-3 hover:bg-gray-100 transition-all duration-200"
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
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={handleChange}
                    className="input-glass"
                    placeholder="First name"
                    required
                  />
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    value={formData.lastName}
                    onChange={handleChange}
                    className="input-glass"
                    placeholder="Last name"
                    required
                  />
                </div>

                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="input-glass"
                  placeholder="name@company.com"
                  required
                />

                <input
                  id="password"
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="input-glass"
                  placeholder="Password (8+ characters)"
                  minLength={8}
                  required
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-secondary w-full py-4 text-base flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <p className="text-xs text-[--text-muted]">
                  By signing up, you agree to our{" "}
                  <Link to="/terms" className="underline hover:text-white transition-colors">Terms</Link>{" "}
                  and{" "}
                  <Link to="/privacy" className="underline hover:text-white transition-colors">Privacy Policy</Link>.
                </p>
              </div>
            </div>

            <div className="mt-8 text-center">
              <span className="text-[--text-muted]">Already have an account? </span>
              <Link to="/login" className="text-[--accent-1] hover:text-[--accent-2] font-medium transition-colors">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

