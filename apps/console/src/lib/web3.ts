/**
 * Web3 Configuration for Nooterra
 * 
 * Supports:
 * - Multiple chains (Polygon, Base, Arbitrum for low-fee transactions)
 * - USDC payments for nano-payments
 * - Sign-In With Ethereum (SIWE) for authentication
 */

import { createConfig, http } from 'wagmi';
import { polygon, base, arbitrum, mainnet } from 'wagmi/chains';
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors';

// WalletConnect Project ID - https://cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID || '946b25b33d5bf1a42b32971e742ce05d';

// Supported chains - focus on L2s for low fees
export const supportedChains = [polygon, base, arbitrum, mainnet] as const;

// Default chain for payments (Polygon for lowest fees)
export const defaultChain = polygon;

// Wagmi config
export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: [
    injected(),
    walletConnect({ 
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: {
        name: 'Nooterra',
        description: 'AI Agent Coordination Network',
        url: 'https://www.nooterra.ai',
        icons: ['https://www.nooterra.ai/logo.png'],
      },
    }),
    coinbaseWallet({
      appName: 'Nooterra',
      appLogoUrl: 'https://www.nooterra.ai/logo.png',
    }),
  ],
  transports: {
    [polygon.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [mainnet.id]: http(),
  },
});

// Token addresses per chain
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  [polygon.id]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC on Polygon
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  [arbitrum.id]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
  [mainnet.id]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Mainnet
};

// Nooterra Treasury Wallet (receives USDC payments)
export const TREASURY_ADDRESS: `0x${string}` = '0xb35b717e9aef9f9527ed0f8c19146a8aa5198000';

// Nooterra Payment Contract (will be deployed)
export const NOOTERRA_PAYMENT_ADDRESSES: Record<number, `0x${string}` | null> = {
  [polygon.id]: null, // Deploy address here
  [base.id]: null,
  [arbitrum.id]: null,
  [mainnet.id]: null,
};

// ERC20 ABI for USDC transfers
export const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

// Nooterra Credits Contract ABI (for depositing USDC and getting credits)
export const NOOTERRA_CREDITS_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'payAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentAddress', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'workflowId', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

// Helper to format addresses
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Helper to get chain name
export function getChainName(chainId: number): string {
  const chain = supportedChains.find(c => c.id === chainId);
  return chain?.name || 'Unknown';
}

// SIWE message generator
export function createSiweMessage(
  address: string,
  chainId: number,
  nonce: string,
  expirationTime?: string
): string {
  const domain = typeof window !== 'undefined' ? window.location.host : 'nooterra.ai';
  const uri = typeof window !== 'undefined' ? window.location.origin : 'https://nooterra.ai';
  const issuedAt = new Date().toISOString();
  const expiration = expirationTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Nooterra - The AI Agent Coordination Network

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expiration}`;
}

// Parse SIWE message
export function parseSiweMessage(message: string): {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
} | null {
  try {
    const lines = message.split('\n');
    const domain = lines[0].replace(' wants you to sign in with your Ethereum account:', '');
    const address = lines[1];
    const statement = lines[3];
    
    const getValue = (prefix: string) => {
      const line = lines.find(l => l.startsWith(prefix));
      return line ? line.replace(prefix, '') : '';
    };

    return {
      domain,
      address,
      statement,
      uri: getValue('URI: '),
      version: getValue('Version: '),
      chainId: parseInt(getValue('Chain ID: ')),
      nonce: getValue('Nonce: '),
      issuedAt: getValue('Issued At: '),
      expirationTime: getValue('Expiration Time: '),
    };
  } catch {
    return null;
  }
}

