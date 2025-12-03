import React from "react";

// Stripe integration hook for payment processing
// In production, use @stripe/stripe-js and @stripe/react-stripe-js

type PaymentIntent = {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
};

type StripeConfig = {
  publicKey: string;
};

export function useStripe(config?: StripeConfig) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  // Create a payment intent for credit purchase
  const createPaymentIntent = async (
    amount: number, // Amount in cents
    currency: string = "usd"
  ): Promise<PaymentIntent | null> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${coordUrl}/v1/payments/create-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amount, currency }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create payment intent");
      }

      const data = await res.json();
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Purchase credits
  const purchaseCredits = async (creditAmount: number): Promise<boolean> => {
    // 1 NCR = $0.01, so 1000 NCR = $10
    const usdAmount = Math.ceil(creditAmount * 0.01 * 100); // Convert to cents

    const intent = await createPaymentIntent(usdAmount);
    if (!intent) return false;

    // In production, open Stripe checkout or use Elements
    console.log("Payment intent created:", intent);
    
    // For demo, simulate success
    return true;
  };

  // Get subscription status
  const getSubscription = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${coordUrl}/v1/payments/subscription`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Create checkout session for subscription
  const createCheckoutSession = async (priceId: string): Promise<string | null> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${coordUrl}/v1/payments/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ priceId }),
      });

      if (!res.ok) {
        throw new Error("Failed to create checkout session");
      }

      const data = await res.json();
      return data.url;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    createPaymentIntent,
    purchaseCredits,
    getSubscription,
    createCheckoutSession,
  };
}

export default useStripe;

