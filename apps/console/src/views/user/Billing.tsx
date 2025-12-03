import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import {
  CreditCard,
  Wallet,
  Plus,
  ArrowUpRight,
  Check,
  Loader2,
  Copy,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Zap,
  Shield,
  Globe,
  ChevronRight,
  X,
} from "lucide-react";
import { USDC_ADDRESSES, ERC20_ABI, getChainName, shortenAddress, TREASURY_ADDRESS, supportedChains } from "../../lib/web3";
import { polygon } from "wagmi/chains";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";
const STRIPE_KEY = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY;

type CreditPackage = {
  credits: number;
  usdAmount: number;
  bonus?: number;
  popular?: boolean;
};

const creditPackages: CreditPackage[] = [
  { credits: 100, usdAmount: 1 },
  { credits: 500, usdAmount: 5, bonus: 50 },
  { credits: 1000, usdAmount: 10, bonus: 150, popular: true },
  { credits: 5000, usdAmount: 50, bonus: 1000 },
  { credits: 10000, usdAmount: 100, bonus: 2500 },
  { credits: 50000, usdAmount: 500, bonus: 15000 },
];

type PaymentMethod = "crypto" | "card";

type Transaction = {
  id: string;
  credits_purchased: number;
  amount_cents: number;
  payment_method: string;
  tx_hash?: string;
  chain_id?: number;
  status: string;
  created_at: string;
};

export default function Billing() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("crypto");
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useBalance({
    address,
    token: chainId ? USDC_ADDRESSES[chainId] : undefined,
  });

  // Contract write for USDC transfer
  const { writeContract, data: writeData, isPending: isWriting, error: writeError, reset: resetWrite } = useWriteContract();
  
  // Wait for transaction
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: writeData,
  });

  // Fetch balance and transactions
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const [balanceRes, txRes] = await Promise.all([
        fetch(`${COORD_URL}/v1/payments/balance`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${COORD_URL}/v1/payments/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (balanceRes.ok) {
        const data = await balanceRes.json();
        setBalance(data.balance || 0);
      }

      if (txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error("Failed to fetch billing data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Record payment after confirmation
  useEffect(() => {
    if (isConfirmed && writeData && selectedPackage) {
      recordPayment(writeData);
    }
  }, [isConfirmed, writeData, selectedPackage]);

  const recordPayment = async (hash: string) => {
    const token = localStorage.getItem("nooterra_token");
    if (!token || !address || !chainId || !selectedPackage) return;

    try {
      const res = await fetch(`${COORD_URL}/v1/payments/crypto/record`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          txHash: hash,
          chainId,
          amount: (selectedPackage.usdAmount * 1_000_000).toString(),
          fromAddress: address,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setBalance((prev) => prev + data.credits);
        setTxHash(hash);
        setShowPurchase(false);
        setSelectedPackage(null);
        resetWrite();
        refetchBalance();
      }
    } catch (err) {
      console.error("Failed to record payment:", err);
    } finally {
      setPurchasing(false);
    }
  };

  const handleCryptoPurchase = async () => {
    if (!selectedPackage || !address) return;
    setError(null);
    setPurchasing(true);
    
    // Ensure on Polygon for cheapest fees
    if (chainId !== polygon.id) {
      try {
        await switchChain({ chainId: polygon.id });
      } catch {
        setError("Please switch to Polygon network");
        setPurchasing(false);
        return;
      }
    }

    const usdcAddress = USDC_ADDRESSES[polygon.id];
    const amount = BigInt(Math.floor(selectedPackage.usdAmount * 1_000_000)); // 6 decimals

    try {
      writeContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [TREASURY_ADDRESS, amount],
      });
    } catch (err: any) {
      console.error("Transfer failed:", err);
      setError(err.message || "Transaction failed");
      setPurchasing(false);
    }
  };

  const handleStripePurchase = async () => {
    if (!selectedPackage) return;
    setError(null);
    setPurchasing(true);

    const token = localStorage.getItem("nooterra_token");
    
    try {
      const res = await fetch(`${COORD_URL}/v1/payments/create-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount: selectedPackage.credits + (selectedPackage.bonus || 0),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create payment");
      }

      const data = await res.json();
      
      if (data.demo) {
        // Demo mode - instant credit
        setBalance((prev) => prev + data.credits);
        setShowPurchase(false);
        setSelectedPackage(null);
      } else if (data.clientSecret && STRIPE_KEY) {
        // Real Stripe - would redirect to checkout
        // For now, show instructions
        setError("Stripe checkout coming soon. Use crypto for instant purchase!");
      }
    } catch (err: any) {
      setError(err.message || "Payment failed");
    } finally {
      setPurchasing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#4f7cff]" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Credits & Billing</h1>
          <p className="text-[#707090]">Power your AI workflows with NCR credits</p>
        </div>

        {/* Balance Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden bg-gradient-to-br from-[#0f0f18] to-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl p-6 mb-8"
        >
          {/* Glow effect */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#4f7cff]/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-[#00d4ff]/10 rounded-full blur-[80px]" />
          
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[#707090] text-sm mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Available Credits
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-white">{balance.toLocaleString()}</span>
                <span className="text-[#4f7cff] font-semibold text-xl">NCR</span>
              </div>
              <div className="text-[#909098] text-sm mt-2">
                ≈ ${(balance / 100).toFixed(2)} USD value
              </div>
              {isConnected && usdcBalance && (
                <div className="mt-4 flex items-center gap-2 text-sm">
                  <Wallet className="w-4 h-4 text-[#00d4ff]" />
                  <span className="text-[#707090]">Wallet:</span>
                  <span className="text-white">{Number(usdcBalance.formatted).toFixed(2)} USDC</span>
                  <span className="text-[#505060]">on {getChainName(chainId || 1)}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowPurchase(true)}
              className="btn-neural text-lg px-6 py-3"
            >
              <Plus className="w-5 h-5" /> Add Credits
            </button>
          </div>
        </motion.div>

        {/* Success notification */}
        <AnimatePresence>
          {txHash && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6 p-4 bg-[#39ff8e]/10 border border-[#39ff8e]/20 rounded-xl flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-[#39ff8e]/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-[#39ff8e]" />
              </div>
              <div className="flex-1">
                <div className="text-[#39ff8e] font-semibold">Payment successful!</div>
                <div className="text-[#909098] text-sm flex items-center gap-2">
                  {shortenAddress(txHash)}
                  <button onClick={() => handleCopy(txHash)} className="text-[#707090] hover:text-white">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <a
                    href={`https://polygonscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#707090] hover:text-white"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <button onClick={() => setTxHash(null)} className="text-[#707090] hover:text-white p-2">
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Purchase Modal */}
        <AnimatePresence>
          {showPurchase && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => !purchasing && setShowPurchase(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="p-6 border-b border-[#4f7cff]/10">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">Purchase Credits</h2>
                    <button
                      onClick={() => setShowPurchase(false)}
                      className="text-[#707090] hover:text-white p-2"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Payment Method Toggle */}
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setPaymentMethod("crypto")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 transition-all ${
                        paymentMethod === "crypto"
                          ? "border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]"
                          : "border-[#4f7cff]/10 text-[#707090] hover:border-[#4f7cff]/30"
                      }`}
                    >
                      <Wallet className="w-5 h-5" />
                      <span className="font-medium">Crypto (USDC)</span>
                      <span className="text-xs bg-[#39ff8e]/20 text-[#39ff8e] px-2 py-0.5 rounded-full">Instant</span>
                    </button>
                    <button
                      onClick={() => setPaymentMethod("card")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 transition-all ${
                        paymentMethod === "card"
                          ? "border-[#a855f7] bg-[#a855f7]/10 text-[#a855f7]"
                          : "border-[#4f7cff]/10 text-[#707090] hover:border-[#4f7cff]/30"
                      }`}
                    >
                      <CreditCard className="w-5 h-5" />
                      <span className="font-medium">Card</span>
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  {/* Package Selection */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {creditPackages.map((pkg) => (
                      <button
                        key={pkg.credits}
                        onClick={() => setSelectedPackage(pkg)}
                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                          selectedPackage?.credits === pkg.credits
                            ? "border-[#4f7cff] bg-[#4f7cff]/10 scale-[1.02]"
                            : "border-[#4f7cff]/10 hover:border-[#4f7cff]/30 bg-[#0f0f18]"
                        }`}
                      >
                        {pkg.popular && (
                          <span className="absolute -top-2 -right-2 px-2 py-0.5 text-[10px] font-bold bg-gradient-to-r from-[#4f7cff] to-[#00d4ff] text-white rounded-full">
                            BEST VALUE
                          </span>
                        )}
                        <div className="text-white font-bold text-lg">
                          {pkg.credits.toLocaleString()}
                        </div>
                        <div className="text-[#4f7cff] text-xs font-medium">NCR</div>
                        <div className="text-[#707090] text-sm mt-2">${pkg.usdAmount}</div>
                        {pkg.bonus && (
                          <div className="text-[#39ff8e] text-xs mt-1 font-medium">
                            +{pkg.bonus.toLocaleString()} bonus
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Benefits */}
                  {paymentMethod === "crypto" && (
                    <div className="grid grid-cols-3 gap-3 mb-6 text-center">
                      <div className="p-3 bg-[#0f0f18] rounded-lg">
                        <Zap className="w-5 h-5 text-[#00d4ff] mx-auto mb-1" />
                        <div className="text-xs text-[#707090]">Instant</div>
                      </div>
                      <div className="p-3 bg-[#0f0f18] rounded-lg">
                        <Shield className="w-5 h-5 text-[#39ff8e] mx-auto mb-1" />
                        <div className="text-xs text-[#707090]">No fees</div>
                      </div>
                      <div className="p-3 bg-[#0f0f18] rounded-lg">
                        <Globe className="w-5 h-5 text-[#a855f7] mx-auto mb-1" />
                        <div className="text-xs text-[#707090]">Global</div>
                      </div>
                    </div>
                  )}

                  {/* Selected Package Summary */}
                  {selectedPackage && (
                    <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-4 mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[#707090]">Credits</span>
                        <span className="text-white font-medium">
                          {(selectedPackage.credits + (selectedPackage.bonus || 0)).toLocaleString()} NCR
                        </span>
                      </div>
                      {selectedPackage.bonus && (
                        <div className="flex items-center justify-between mb-2 text-sm">
                          <span className="text-[#39ff8e]">Bonus included</span>
                          <span className="text-[#39ff8e]">+{selectedPackage.bonus.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t border-[#4f7cff]/10">
                        <span className="text-[#707090]">Total</span>
                        <span className="text-white font-bold text-xl">
                          ${selectedPackage.usdAmount} {paymentMethod === "crypto" ? "USDC" : "USD"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Error Display */}
                  {(error || writeError) && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error || writeError?.message?.slice(0, 100) || "Transaction failed"}
                    </div>
                  )}

                  {/* Not connected warning */}
                  {paymentMethod === "crypto" && !isConnected && (
                    <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-2 text-yellow-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      Connect your wallet first to pay with crypto
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowPurchase(false)}
                      disabled={purchasing || isWriting || isConfirming}
                      className="flex-1 btn-ghost py-3"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={paymentMethod === "crypto" ? handleCryptoPurchase : handleStripePurchase}
                      disabled={!selectedPackage || purchasing || isWriting || isConfirming || (paymentMethod === "crypto" && !isConnected)}
                      className="flex-1 btn-neural py-3"
                    >
                      {isWriting || isConfirming ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {isWriting ? "Confirm in wallet..." : "Processing..."}
                        </>
                      ) : (
                        <>
                          {paymentMethod === "crypto" ? <Wallet className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                          Pay ${selectedPackage?.usdAmount || 0}
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-[#505060] text-xs text-center mt-4">
                    {paymentMethod === "crypto" 
                      ? "Payments processed on Polygon. ~$0.001 gas fee." 
                      : "Secure payment via Stripe. 2.9% + $0.30 fee."}
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transaction History */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Transaction History</h2>
          
          {transactions.length === 0 ? (
            <div className="text-center py-12 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl">
              <Sparkles className="w-12 h-12 text-[#4f7cff]/30 mx-auto mb-4" />
              <p className="text-[#707090]">No transactions yet</p>
              <p className="text-[#505060] text-sm">Purchase credits to power your AI workflows</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <motion.div
                  key={tx.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-between p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/20 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      tx.payment_method === "crypto" 
                        ? "bg-[#00d4ff]/10 text-[#00d4ff]" 
                        : "bg-[#a855f7]/10 text-[#a855f7]"
                    }`}>
                      {tx.payment_method === "crypto" ? (
                        <Wallet className="w-5 h-5" />
                      ) : (
                        <CreditCard className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <div className="text-white font-medium flex items-center gap-2">
                        +{tx.credits_purchased.toLocaleString()} NCR
                        {tx.status === "completed" && (
                          <Check className="w-4 h-4 text-[#39ff8e]" />
                        )}
                      </div>
                      <div className="text-[#707090] text-sm flex items-center gap-2">
                        {tx.tx_hash ? (
                          <>
                            {shortenAddress(tx.tx_hash)}
                            <a
                              href={`https://polygonscan.com/tx/${tx.tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#4f7cff] hover:text-[#00d4ff]"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        ) : (
                          new Date(tx.created_at).toLocaleDateString()
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-medium">
                      ${(tx.amount_cents / 100).toFixed(2)}
                    </div>
                    <div className={`text-xs ${
                      tx.status === "completed" ? "text-[#39ff8e]" : 
                      tx.status === "pending_verification" ? "text-yellow-400" : 
                      "text-[#707090]"
                    }`}>
                      {tx.status === "completed" ? "Completed" : 
                       tx.status === "pending_verification" ? "Verifying" : 
                       tx.status}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 grid md:grid-cols-2 gap-4"
        >
          <div className="p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#4f7cff]" />
              How Credits Work
            </h3>
            <ul className="space-y-2 text-sm text-[#909098]">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>1 NCR ≈ $0.01 USD</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Pay only for what you use (nano-payments)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Credits never expire</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Refund available for unused credits</span>
              </li>
            </ul>
          </div>

          <div className="p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#00d4ff]" />
              Why USDC?
            </h3>
            <ul className="space-y-2 text-sm text-[#909098]">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Stable value (1 USDC = $1 USD)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Instant settlement (no 3-day hold)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>~$0.001 transaction fees on Polygon</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#39ff8e] mt-0.5 flex-shrink-0" />
                <span>Works anywhere in the world</span>
              </li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
