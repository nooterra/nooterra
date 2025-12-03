/**
 * Wallet Connect Component
 * Beautiful wallet connection UI with support for multiple wallets
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConnect, useAccount, useDisconnect, useBalance } from 'wagmi';
import { Wallet, ChevronDown, X, ExternalLink, Copy, Check, Loader2 } from 'lucide-react';
import { shortenAddress, getChainName, USDC_ADDRESSES } from '../lib/web3';
import { useAuth } from '../contexts/AuthContext';

// Wallet icons
const walletIcons: Record<string, string> = {
  'MetaMask': '🦊',
  'WalletConnect': '🔗',
  'Coinbase Wallet': '🔵',
  'Injected': '💉',
};

export function WalletConnectButton() {
  const { connectors, connect, isPending } = useConnect();
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { user, isLoading, signIn, signOut, isAuthenticated } = useAuth();
  
  const [showModal, setShowModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // Get USDC balance
  const { data: usdcBalance } = useBalance({
    address,
    token: chainId ? USDC_ADDRESSES[chainId] : undefined,
  });

  const handleConnect = async (connector: typeof connectors[0]) => {
    try {
      await connect({ connector });
      setShowModal(false);
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      console.error('Sign in failed:', err);
    } finally {
      setSigningIn(false);
    }
  };

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    signOut();
    setShowDropdown(false);
  };

  // Not connected - show connect button
  if (!isConnected) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="btn-neural flex items-center gap-2"
        >
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </button>

        {/* Wallet Selection Modal */}
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl p-6 shadow-[0_0_50px_rgba(79,124,255,0.15)]"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">Connect Wallet</h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-[#707090] hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-[#707090] text-sm mb-6">
                  Connect your wallet to access Nooterra. Your wallet is your identity - no email or password needed.
                </p>

                <div className="space-y-3">
                  {connectors.map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => handleConnect(connector)}
                      disabled={isPending}
                      className="w-full flex items-center gap-4 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 hover:bg-[#4f7cff]/5 transition-all disabled:opacity-50"
                    >
                      <span className="text-2xl">
                        {walletIcons[connector.name] || '🔗'}
                      </span>
                      <span className="text-white font-medium">{connector.name}</span>
                      {isPending && (
                        <Loader2 className="w-4 h-4 ml-auto animate-spin text-[#4f7cff]" />
                      )}
                    </button>
                  ))}
                </div>

                <p className="text-[#505060] text-xs text-center mt-6">
                  By connecting, you agree to our Terms of Service
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Connected but not signed in
  if (!isAuthenticated) {
    return (
      <button
        onClick={handleSignIn}
        disabled={signingIn || isLoading}
        className="btn-neural flex items-center gap-2"
      >
        {signingIn ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            Sign In
          </>
        )}
      </button>
    );
  }

  // Fully authenticated
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 px-4 py-2 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl hover:border-[#4f7cff]/40 transition-all"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center text-white text-sm font-bold">
          {address?.slice(2, 4).toUpperCase()}
        </div>
        <div className="text-left">
          <div className="text-white text-sm font-medium">
            {user?.name || shortenAddress(address || '')}
          </div>
          <div className="text-[#707090] text-xs">
            {user?.credits.toLocaleString()} NCR
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[#707090] transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute right-0 mt-2 w-72 bg-[#0a0a12] border border-[#4f7cff]/20 rounded-xl shadow-xl overflow-hidden z-50"
          >
            {/* Balance Section */}
            <div className="p-4 border-b border-[#4f7cff]/10">
              <div className="text-xs text-[#707090] mb-1">Balance</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">
                  {user?.credits.toLocaleString()}
                </span>
                <span className="text-[#4f7cff]">NCR</span>
              </div>
              {usdcBalance && (
                <div className="text-sm text-[#707090] mt-1">
                  ≈ ${Number(usdcBalance.formatted).toFixed(2)} USDC
                </div>
              )}
            </div>

            {/* Wallet Info */}
            <div className="p-4 border-b border-[#4f7cff]/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#707090]">Wallet</span>
                <span className="text-xs text-[#4f7cff]">{getChainName(chainId || 1)}</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-white font-mono bg-[#0f0f18] px-3 py-2 rounded-lg">
                  {shortenAddress(address || '')}
                </code>
                <button
                  onClick={handleCopyAddress}
                  className="p-2 text-[#707090] hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <a
                  href={`https://polygonscan.com/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-[#707090] hover:text-white transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2">
              <button
                onClick={() => {
                  setShowDropdown(false);
                  // Navigate to billing
                  window.location.href = user?.role === 'organization' ? '/org/billing' : '/app/billing';
                }}
                className="w-full text-left px-4 py-3 text-sm text-white hover:bg-[#4f7cff]/10 rounded-lg transition-colors"
              >
                Add Credits
              </button>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  window.location.href = user?.role === 'organization' ? '/org/settings' : '/app/settings';
                }}
                className="w-full text-left px-4 py-3 text-sm text-white hover:bg-[#4f7cff]/10 rounded-lg transition-colors"
              >
                Settings
              </button>
              <button
                onClick={handleDisconnect}
                className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

// Simple connect button for use in other places
export function ConnectButton({ className = '' }: { className?: string }) {
  const { isConnected } = useAccount();
  const { isAuthenticated } = useAuth();

  if (isConnected && isAuthenticated) {
    return null;
  }

  return <WalletConnectButton />;
}

