import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { toast } from 'sonner';
import { KAIROS_API_URL } from '@/lib/stellar';

interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  balance: string;
  usdcBalance: string;
  connect: () => void;
  disconnect: () => void;
  refreshBalance: () => void;
  isSponsoring: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0.0000000");
  const [usdcBalance, setUsdcBalance] = useState<string>("0.0000000");
  const [isSponsoring, setIsSponsoring] = useState(false);
  const kitRef = useRef<any>(null);

  // Lazy-init Stellar Wallets Kit (avoids crash at module load)
  const getKit = useCallback(async () => {
    if (kitRef.current) return kitRef.current;
    try {
      const walletKit = await import('@creit.tech/stellar-wallets-kit');
      const { StellarWalletsKit, WalletNetwork } = walletKit;
      
      // Handle different API versions: allowAllModules (v1.x) vs allowAll (v0.x)
      const getAllModules = (walletKit as any).allowAllModules 
        || (walletKit as any).allowAll 
        || (() => []);
      
      kitRef.current = new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        selectedWalletId: 'freighter',
        modules: getAllModules(),
      });
      return kitRef.current;
    } catch (err) {
      console.error('[Kairos] Failed to initialize Stellar Wallets Kit:', err);
      return null;
    }
  }, []);

  // Load address from localStorage on mount
  useEffect(() => {
    const savedAddress = localStorage.getItem('kairos_address');
    if (savedAddress) {
      setAddress(savedAddress);
    }
  }, []);

  // Fetch balance from backend
  const failCountRef = useRef(0);
  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const response = await fetch(`${KAIROS_API_URL}/api/stellar/balance/${address}`);
      const data = await response.json();
      if (data.balance) {
        setBalance(data.balance);
      }
      if (typeof data.usdc === 'string') {
        setUsdcBalance(data.usdc);
      }
      failCountRef.current = 0; // Reset on success
    } catch (error) {
      failCountRef.current++;
      if (failCountRef.current <= 2) {
        console.warn('[Kairos] Backend unreachable — balance polling paused');
      }
      // Silently fail after first 2 logs to avoid console spam
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      refreshBalance();
      // Poll every 30s instead of 10s to reduce console noise
      const interval = setInterval(refreshBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [address, refreshBalance]);

  // Sponsorship logic
  const sponsorIfNeeded = useCallback(async (publicKey: string) => {
    setIsSponsoring(true);
    try {
      console.log(`[Stellar] Requesting sponsorship for ${publicKey}`);
      const response = await fetch(`${KAIROS_API_URL}/api/stellar/sponsor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      });
      
      const data = await response.json();
      if (data.success && data.txHash) {
        toast.success('Stellar account sponsored by Kairos! Ready to query.', {
          description: `Transaction: ${data.txHash.slice(0, 8)}...`,
        });
      }
    } catch (error) {
      console.error('Sponsorship failed:', error);
    } finally {
      setIsSponsoring(false);
      refreshBalance();
    }
  }, [refreshBalance]);

  const connect = useCallback(async () => {
    try {
      const kit = await getKit();
      if (!kit) {
        toast.error('Stellar wallet kit unavailable. Please install Freighter.');
        return;
      }
      await kit.openModal({
        onWalletSelected: async (option: any) => {
          kit.setWallet(option.id);
          const { address: userAddress } = await kit.getAddress();
          
          setAddress(userAddress);
          localStorage.setItem('kairos_address', userAddress);
          toast.success('Wallet connected!');
          
          await sponsorIfNeeded(userAddress);
        }
      });
    } catch (error: any) {
      console.error('Connection failed:', error);
      toast.error('Failed to connect wallet');
    }
  }, [getKit, sponsorIfNeeded]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setBalance("0.0000000");
    setUsdcBalance("0.0000000");
    localStorage.removeItem('kairos_address');
    toast.info('Wallet disconnected');
  }, []);

  return (
    <WalletContext.Provider value={{
      isConnected: !!address,
      address,
      balance,
      usdcBalance,
      connect,
      disconnect,
      refreshBalance,
      isSponsoring
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
