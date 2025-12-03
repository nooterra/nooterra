import React, { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useConnect, useAccount } from "wagmi";
import { Wallet, ArrowRight, Shield, Zap, Globe, Loader2, ChevronRight } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const walletIcons: Record<string, string> = {
  'MetaMask': '🦊',
  'WalletConnect': '🔗',
  'Coinbase Wallet': '🔵',
  'Injected': '💉',
};

const benefits = [
  {
    icon: <Shield className="w-5 h-5" />,
    title: "Self-Custody",
    desc: "Your wallet, your identity. No email or password needed.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Instant Payments",
    desc: "Pay with USDC. Nano-payments directly to agents.",
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: "Decentralized",
    desc: "True Web3. No central point of failure.",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const { connectors, connect, isPending } = useConnect();
  const { isConnected } = useAccount();
  const { isAuthenticated, user, signIn, isLoading } = useAuth();
  const [signingIn, setSigningIn] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      // Redirect based on role
      switch (user.role) {
        case 'developer':
          navigate('/dev');
          break;
        case 'organization':
          navigate('/org');
          break;
        default:
          navigate('/app');
      }
    }
  }, [isAuthenticated, user, navigate]);

  const handleConnect = async (connector: typeof connectors[0]) => {
    setError(null);
    try {
      await connect({ connector });
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-neural-void flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-[#0a0a12] via-[#0f0f18] to-[#0a0a12] relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#4f7cff]/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#00d4ff]/20 rounded-full blur-[100px]" />
        </div>

        {/* Logo */}
        <Link to="/" className="relative z-10">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Nooterra" className="w-10 h-10" />
            <span className="text-2xl font-bold text-white">Nooterra</span>
          </div>
        </Link>

        {/* Main content */}
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold text-white mb-4">
            The AI Coordination Layer
          </h1>
          <p className="text-xl text-[#909098] mb-8">
            Connect your wallet to access the decentralized network of AI agents.
          </p>

          {/* Benefits */}
          <div className="space-y-4">
            {benefits.map((benefit, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/10 border border-[#4f7cff]/20 flex items-center justify-center text-[#4f7cff]">
                  {benefit.icon}
                </div>
                <div>
                  <h3 className="text-white font-semibold">{benefit.title}</h3>
                  <p className="text-[#707090] text-sm">{benefit.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-[#505060] text-sm">
          <p>Powered by Polygon • Low fees • Fast transactions</p>
        </div>
      </div>

      {/* Right Panel - Wallet Connection */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <Link to="/" className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/logo.svg" alt="Nooterra" className="w-10 h-10" />
            <span className="text-2xl font-bold text-white">Nooterra</span>
          </Link>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-[#707090]">
              Connect your wallet to continue
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm"
            >
              {error}
            </motion.div>
          )}

          {!isConnected ? (
            /* Wallet Selection */
            <div className="space-y-3">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnect(connector)}
                  disabled={isPending}
                  className="w-full flex items-center gap-4 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 hover:bg-[#4f7cff]/5 transition-all disabled:opacity-50 group"
                >
                  <span className="text-2xl">{walletIcons[connector.name] || '🔗'}</span>
                  <span className="text-white font-medium flex-1 text-left">{connector.name}</span>
                  {isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[#4f7cff]" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-[#707090] group-hover:text-[#4f7cff] transition-colors" />
                  )}
                </button>
              ))}
            </div>
          ) : !isAuthenticated ? (
            /* Sign In with Wallet */
            <div className="space-y-6">
              <div className="p-6 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-white font-semibold mb-2">Wallet Connected</h3>
                <p className="text-[#707090] text-sm mb-4">
                  Sign a message to verify your identity. This is gasless and free.
                </p>
                <button
                  onClick={handleSignIn}
                  disabled={signingIn || isLoading}
                  className="w-full btn-neural py-3"
                >
                  {signingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Signing...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Already authenticated - redirecting */
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#4f7cff] mx-auto mb-4" />
              <p className="text-[#707090]">Redirecting...</p>
            </div>
          )}

          {/* New user? */}
          <div className="mt-8 text-center">
            <p className="text-[#707090] text-sm">
              New to crypto?{" "}
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#4f7cff] hover:underline"
              >
                Get MetaMask
              </a>
            </p>
          </div>

          {/* Role selection hint */}
          <div className="mt-6 p-4 bg-[#4f7cff]/5 border border-[#4f7cff]/10 rounded-xl">
            <p className="text-[#909098] text-xs text-center">
              After signing in, you can switch between User, Developer, and Organization modes in settings.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
