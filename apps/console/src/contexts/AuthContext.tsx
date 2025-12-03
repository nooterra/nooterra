/**
 * Authentication Context for Nooterra
 * Manages wallet-based authentication using SIWE
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { createSiweMessage } from '../lib/web3';

interface User {
  address: string;
  chainId: number;
  role: 'user' | 'developer' | 'organization';
  name?: string;
  credits: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  updateRole: (role: User['role']) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || 'https://coord.nooterra.ai';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const token = localStorage.getItem('nooterra_token');
      const storedAddress = localStorage.getItem('nooterra_address');
      
      if (token && storedAddress && address && storedAddress.toLowerCase() === address.toLowerCase()) {
        try {
          const res = await fetch(`${COORD_URL}/v1/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          
          if (res.ok) {
            const data = await res.json();
            setUser({
              address: data.address,
              chainId: data.chainId || chainId || 1,
              role: data.role || 'user',
              name: data.name,
              credits: data.balance || 0,
            });
          } else {
            // Token expired or invalid
            localStorage.removeItem('nooterra_token');
            localStorage.removeItem('nooterra_address');
          }
        } catch (err) {
          console.error('Session check failed:', err);
        }
      }
      setIsLoading(false);
    };

    if (isConnected && address) {
      checkSession();
    } else {
      setIsLoading(false);
      setUser(null);
    }
  }, [address, isConnected, chainId]);

  // Sign in with wallet
  const signIn = useCallback(async () => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    
    try {
      // 1. Get nonce from server
      const nonceRes = await fetch(`${COORD_URL}/v1/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      
      if (!nonceRes.ok) {
        throw new Error('Failed to get nonce');
      }
      
      const { nonce } = await nonceRes.json();
      
      // 2. Create and sign SIWE message
      const message = createSiweMessage(address, chainId, nonce);
      const signature = await signMessageAsync({ message });
      
      // 3. Verify signature with server
      const verifyRes = await fetch(`${COORD_URL}/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, address }),
      });
      
      if (!verifyRes.ok) {
        const error = await verifyRes.json();
        throw new Error(error.error || 'Verification failed');
      }
      
      const { token, user: userData } = await verifyRes.json();
      
      // 4. Store token and update state
      localStorage.setItem('nooterra_token', token);
      localStorage.setItem('nooterra_address', address);
      
      setUser({
        address: userData.address || address,
        chainId: userData.chainId || chainId,
        role: userData.role || 'user',
        name: userData.name,
        credits: userData.balance || 0,
      });
    } catch (err) {
      console.error('Sign in failed:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, chainId, signMessageAsync]);

  // Sign out
  const signOut = useCallback(() => {
    localStorage.removeItem('nooterra_token');
    localStorage.removeItem('nooterra_address');
    setUser(null);
    disconnect();
  }, [disconnect]);

  // Update user role
  const updateRole = useCallback(async (role: User['role']) => {
    const token = localStorage.getItem('nooterra_token');
    if (!token || !user) return;

    const res = await fetch(`${COORD_URL}/v1/auth/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role }),
    });

    if (res.ok) {
      setUser({ ...user, role });
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        signIn,
        signOut,
        updateRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

