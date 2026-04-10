import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { ArrowRight, Copy, ExternalLink, Wallet, Zap } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { KAIROS_API_URL } from '@/lib/stellar';
// (Freighter signs/submits XDR; Stellar SDK is not needed in this component)
import { isConnected as isFreighterConnected, requestAccess as freighterRequestAccess, signTransaction as freighterSignTransaction } from '@stellar/freighter-api';

export default function Deposit() {
  const { isConnected, address, balance, usdcBalance, refreshBalance } = useWallet();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isAddingTrustline, setIsAddingTrustline] = useState(false);
  const [isRequestingUsdc, setIsRequestingUsdc] = useState(false);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address || '');
    toast.success('Stellar address copied to clipboard');
  };

  const handleFaucetRequest = async () => {
    if (!address) return;

    // Rate limiting check
    const lastRequest = localStorage.getItem(`faucet_${address}`);
    if (lastRequest && Date.now() - parseInt(lastRequest) < 24 * 60 * 60 * 1000) {
      toast.error('Daily limit reached. Try again in 24h.');
      return;
    }

    setIsRequesting(true);
    try {
      toast.info('Requesting funds from Stellar Testnet...');
      const res = await fetch(`${KAIROS_API_URL}/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Funds requested! Balance will update shortly.');
        localStorage.setItem(`faucet_${address}`, Date.now().toString());
        refreshBalance();
      } else {
        if (res.status === 429 || data.error?.includes('429')) {
          toast.error('Daily limit reached. Try again in 24h.');
          localStorage.setItem(`faucet_${address}`, Date.now().toString());
          return;
        }
        toast.error('Faucet failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      toast.error('Network error: Is the backend running?');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleAddUsdcTrustline = async () => {
    if (!address) return;
    setIsAddingTrustline(true);
    try {
      // Ask backend for demo-USDC asset definition (issuer is the Kairos treasury)
      const assetRes = await fetch(`${KAIROS_API_URL}/api/stellar/usdc/demo-asset`);
      const assetData = await assetRes.json();
      if (!assetRes.ok || !assetData?.issuer || !assetData?.code) {
        throw new Error(assetData?.error || 'Failed to load USDC asset');
      }

      const issuer = assetData.issuer as string;
      const code = assetData.code as string;

      const acctRes = await fetch(`${KAIROS_API_URL}/api/stellar/usdc/trustline-xdr`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: address }),
      });
      const acctData = await acctRes.json();
      if (!acctRes.ok || !acctData?.xdr) throw new Error(acctData?.error || 'Failed to build trustline tx');

      const xdr = acctData.xdr as string;
      const networkPassphrase = acctData.networkPassphrase as string;

      // Sign with Freighter via official API (reliable detection).
      const connected = await isFreighterConnected();
      if (!connected) {
        throw new Error('Freighter not detected. Make sure the Freighter extension is installed and enabled, then refresh.');
      }

      // Ensure this site is authorized in Freighter (otherwise "Confirm" is disabled).
      // This triggers the Freighter "Connect" flow if needed.
      try {
        await freighterRequestAccess();
      } catch {
        throw new Error('Freighter is installed but not connected to this site. In the Freighter popup, click “Connect” for localhost, then try again.');
      }

      const signed = await freighterSignTransaction(xdr, { networkPassphrase, address });
      const signedXdr =
        typeof signed === 'string'
          ? signed
          : (signed as any)?.signedTxXdr || (signed as any)?.signedXdr || (signed as any)?.xdr;
      if (!signedXdr || typeof signedXdr !== 'string') {
        throw new Error('Freighter returned an unexpected signature payload (missing signed XDR).');
      }

      const submitRes = await fetch(`${KAIROS_API_URL}/api/stellar/submit-xdr`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ xdr: signedXdr }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok || !submitData?.hash) {
        const codes = submitData?.resultCodes
          ? ` result_codes=${JSON.stringify(submitData.resultCodes)}`
          : '';
        throw new Error((submitData?.error || 'Failed to submit trustline') + codes);
      }

      toast.success('USDC trustline added!', { description: `${code}:${issuer.slice(0, 6)}…` });
      refreshBalance();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add USDC trustline');
    } finally {
      setIsAddingTrustline(false);
    }
  };

  const handleUsdcFaucet = async () => {
    if (!address) return;
    setIsRequestingUsdc(true);
    try {
      const res = await fetch(`${KAIROS_API_URL}/api/stellar/usdc/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: address, amount: "10.0000000" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'USDC faucet failed');
      toast.success('USDC sent!', { description: `${data.amount} ${data.code}` });
      refreshBalance();
    } catch (e: any) {
      toast.error(e?.message || 'USDC faucet failed');
    } finally {
      setIsRequestingUsdc(false);
    }
  };

  const faucetCooldown = (() => {
    if (!address) return false;
    const lastRequest = localStorage.getItem(`faucet_${address}`);
    if (lastRequest) {
      return Date.now() - parseInt(lastRequest) < 24 * 60 * 60 * 1000;
    }
    return false;
  })();

  return (
    <Layout>
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="pb-3">
            <h1 className="text-2xl font-medium text-foreground tracking-tight">Fund Your Wallet</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Fund your Stellar wallet with XLM to start querying agents
            </p>
          </div>

          {!isConnected ? (
            <div className="glass-card p-8 text-center">
              <Wallet className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connect your Stellar wallet to get started</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Current Balance */}
              <div className="glass-card glass-shimmer p-6">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Your Balance</p>
              <p className="text-4xl font-display font-semibold">
                  <span className="kairos-gradient">{parseFloat(balance).toFixed(2)}</span>
                  <span className="text-lg text-muted-foreground ml-2">XLM</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{parseFloat(usdcBalance).toFixed(2)}</span> USDC
                </p>
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="status-dot" />
                  <span className="text-xs text-muted-foreground">Stellar Testnet</span>
                </div>
              </div>

              {/* Deposit Address */}
              <div className="glass-card glass-shimmer p-6">
                <h2 className="text-lg font-medium text-foreground mb-4">Your Stellar Address</h2>
                <div className="bg-secondary rounded-lg p-4 border border-border/30">
                  <p className="text-xs text-muted-foreground mb-2">
                    Send XLM on Stellar Testnet to this address
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-foreground/80 break-all">
                      {address}
                    </code>
                    <button
                      onClick={handleCopyAddress}
                      className="p-2 hover:bg-secondary/80 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <a
                  href={`https://stellar.expert/explorer/testnet/account/${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  View on Stellar Expert
                </a>
              </div>

              {/* Testnet Faucet */}
              <div className="glass-card glass-shimmer p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <h2 className="text-lg font-medium text-foreground">Testnet Faucet</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Request free XLM on Stellar Testnet to try Kairos agents. Limited to one request per 24 hours.
                </p>
                <button
                  onClick={handleFaucetRequest}
                  disabled={isRequesting || faucetCooldown}
                  className={cn(
                    'w-full py-3 rounded-full text-sm font-medium flex items-center justify-center gap-2 transition-all',
                    isRequesting || faucetCooldown
                      ? 'bg-secondary/50 text-muted-foreground cursor-not-allowed border border-border/10'
                      : 'glass-primary text-primary-foreground hover:opacity-90'
                  )}
                >
                  {isRequesting ? (
                    <>Requesting...</>
                  ) : faucetCooldown ? (
                    <>Faucet Limit Reached (24h)</>
                  ) : (
                    <>
                      Request Testnet Funds
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              {/* USDC Faucet (demo) */}
              <div className="glass-card glass-shimmer p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-[hsl(195_90%_55%)]" />
                  <h2 className="text-lg font-medium text-foreground">USDC Faucet (Demo)</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Add a trustline, then request demo USDC on Stellar Testnet. This is a hackathon-friendly flow
                  where the Kairos treasury acts as the issuer for testnet.
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    onClick={handleAddUsdcTrustline}
                    disabled={isAddingTrustline}
                    className={cn(
                      'w-full py-3 rounded-full text-sm font-medium flex items-center justify-center gap-2 transition-all',
                      isAddingTrustline
                        ? 'bg-secondary/50 text-muted-foreground cursor-not-allowed border border-border/10'
                        : 'glass-btn text-foreground hover:text-primary'
                    )}
                  >
                    {isAddingTrustline ? 'Adding trustline…' : '1) Add USDC trustline'}
                  </button>
                  <button
                    onClick={handleUsdcFaucet}
                    disabled={isRequestingUsdc}
                    className={cn(
                      'w-full py-3 rounded-full text-sm font-medium flex items-center justify-center gap-2 transition-all',
                      isRequestingUsdc
                        ? 'bg-secondary/50 text-muted-foreground cursor-not-allowed border border-border/10'
                        : 'glass-primary text-primary-foreground hover:opacity-90'
                    )}
                  >
                    {isRequestingUsdc ? 'Requesting…' : '2) Request demo USDC'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
