import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Search, Star, Clock, Zap, ArrowRight, TrendingUp, Newspaper, BarChart3, Coins, PieChart, Image, Activity, ArrowLeftRight, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useWallet } from '@/contexts/WalletContext';

const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS || '';

const categories = ['All', 'DeFi', 'Analytics', 'Trading', 'Stellar', 'Research'];

const AGENT_META: Record<string, { icon: any; color: string; gradient: string }> = {
  'oracle':        { icon: TrendingUp,     color: '#a78bfa', gradient: 'from-violet-500/20 to-purple-600/10' },
  'news':          { icon: Newspaper,      color: '#60a5fa', gradient: 'from-blue-500/20 to-sky-600/10'     },
  'stellar-scout': { icon: BarChart3,      color: '#34d399', gradient: 'from-emerald-500/20 to-teal-600/10' },
  'yield':         { icon: Coins,          color: '#fbbf24', gradient: 'from-yellow-500/20 to-amber-600/10' },
  'tokenomics':    { icon: PieChart,       color: '#f87171', gradient: 'from-red-500/20 to-rose-600/10'     },
  'perp':          { icon: Activity,       color: '#38bdf8', gradient: 'from-sky-400/20 to-cyan-600/10'     },
  'protocol':      { icon: Database,       color: '#818cf8', gradient: 'from-indigo-500/20 to-blue-600/10'  },
  'bridges':       { icon: ArrowLeftRight, color: '#fb7185', gradient: 'from-rose-400/20 to-pink-600/10' },
  'stellar-dex':   { icon: Zap,            color: '#facc15', gradient: 'from-yellow-400/20 to-amber-600/10'},
};

interface Provider {
  id: string;
  name: string;
  description: string;
  category: string;
  rating: number;
  reviews: number;
  price: number;
  responseTime: string;
  verified: boolean;
  popular: boolean;
}

export default function Providers() {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();

  const [searchQuery,        setSearchQuery]        = useState('');
  const [selectedCategory,   setSelectedCategory]   = useState('All');
  const [providers,          setProviders]          = useState<Provider[]>([]);
  const [loading,            setLoading]            = useState(true);
  const [connectedProviderId, setConnectedProviderId] = useState<string | null>(null);
  const [x402Sellers, setX402Sellers] = useState<Record<string, string> | null>(null);
  const [showX402HowTo, setShowX402HowTo] = useState(false);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundStep, setPlaygroundStep] = useState<'idle' | 'got_402' | 'paid' | 'success'>('idle');
  const [playgroundTxHash, setPlaygroundTxHash] = useState<string | null>(null);
  const [playground402, setPlayground402] = useState<any>(null);
  const [playgroundSuccess, setPlaygroundSuccess] = useState<any>(null);

  useEffect(() => {
    const stored = localStorage.getItem('active_provider_id');
    if (stored) setConnectedProviderId(stored);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const res  = await fetch(`${API_BASE_URL}/providers`);
        const data = await res.json();
        if (data.providers) {
          setProviders(data.providers.map((p: any, i: number) => ({
            id:           p.id,
            name:         p.name,
            description:  p.description || 'Specialized AI agent on Stellar.',
            category:     p.category    || 'Analytics',
            rating:       p.rating      || 0,
            reviews:      p.totalRatings || 0,
            price:        parseFloat(p.price),
            responseTime: p.avgResponseTime || '—',
            verified:     true,
            popular:      i === 0,
          })));
        }
      } catch {
        toast.error('Failed to load agents');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const res = await fetch(`${API_BASE_URL}/api/x402/health`);
        const data = await res.json();
        if (data?.agents) setX402Sellers(data.agents);
      } catch {
        // Optional: page works without this.
      }
    })();
  }, []);

  const filtered = providers.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const handleConnect = (provider: Provider) => {
    localStorage.setItem('active_provider_id',   provider.id);
    localStorage.setItem('active_provider_name', provider.name);
    setConnectedProviderId(provider.id);
    navigate('/dashboard', { state: { providerId: provider.id, providerName: provider.name } });
  };

  return (
    <Layout>
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="animate-fade-in-up">
            <div className="flex items-center gap-2 mb-1">
              <span className="status-dot" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Agent Marketplace</span>
            </div>
            <h1 className="text-3xl font-display font-semibold gradient-heading">AI Agents</h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-lg">
              Discover specialized agents. Each call settles on{' '}
              <span className="text-[hsl(195_90%_55%)] font-medium">Stellar Testnet</span> via x402.
            </p>
          </div>

          {/* ── Stats row ──────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3 animate-fade-in-up delay-100">
            {[
              { label: 'Active Agents',   value: providers.length || '—',  color: '#a78bfa' },
              { label: 'Avg Price',        value: '$0.015/call',              color: '#fbbf24' },
              { label: 'Network',          value: 'Stellar',                  color: '#34d399' },
            ].map(({ label, value, color }) => (
              <div key={label} className="glass-card px-4 py-3">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className="text-lg font-display font-semibold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── Search + filters ───────────────────────────────────── */}
          <div className="space-y-3 animate-fade-in-up delay-200">
            <div className="relative max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                id="agent-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="kairos-input w-full pl-10 pr-4 py-2.5 text-sm"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto scrollbar-hidden pb-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200',
                    selectedCategory === cat
                      ? 'bg-primary/15 text-primary border border-primary/25 shadow-[0_0_16px_hsl(var(--primary)/0.15)]'
                      : 'glass-btn text-muted-foreground hover:text-foreground'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* ── Paid API Demo (x402) ───────────────────────────────── */}
          <div className="animate-fade-in-up delay-250">
            <div className="glass-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="status-dot-payment" />
                    <p className="text-sm font-semibold text-foreground">Paid API Demo (x402)</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                    These marketplace APIs are paywalled. First you get a <span className="text-foreground font-medium">402 Payment required</span>,
                    then you pay on Stellar, then you retry with the transaction hash as your receipt.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    This demo applies to <span className="text-foreground font-medium">/api/x402/*</span> endpoints. The chat{" "}
                    <span className="text-foreground font-medium">/query</span> flow is separate.
                  </p>
                </div>

                <button
                  onClick={() => setShowX402HowTo(v => !v)}
                  className={cn(
                    "px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200",
                    showX402HowTo ? "bg-primary/15 text-primary border border-primary/25" : "glass-btn text-muted-foreground hover:text-foreground"
                  )}
                >
                  {showX402HowTo ? "Hide steps" : "Show steps"}
                </button>
              </div>

              {showX402HowTo && (
                <div className="mt-4 space-y-4">
                  <ol className="list-decimal pl-4 space-y-2 text-xs text-muted-foreground">
                    <li>
                      Call an endpoint (no receipt yet) → server returns <span className="text-foreground font-medium">402</span> with payment instructions.
                    </li>
                    <li>
                      Send a Stellar testnet payment to the seller (agent) address (USDC) and get a <span className="text-foreground font-medium">tx hash</span>.
                    </li>
                    <li>
                      Retry the same HTTP request with header <span className="text-foreground font-medium">x402-tx-hash</span>.
                    </li>
                  </ol>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/40 bg-black/30 p-3">
                      <p className="text-[11px] font-semibold text-foreground mb-2">1) Call (expect 402)</p>
                      <pre className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
{`curl "${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/x402/oracle/price?symbol=XLM"`}
                      </pre>
                    </div>

                    <div className="rounded-xl border border-border/40 bg-black/30 p-3">
                      <p className="text-[11px] font-semibold text-foreground mb-2">2) Retry with receipt</p>
                      <pre className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
{`curl "${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/x402/oracle/price?symbol=XLM" \\
  -H "x402-tx-hash: <STELLAR_TX_HASH>"`}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/40 bg-white/5 p-3">
                    <p className="text-[11px] font-semibold text-foreground mb-1">Seller (oracle) address</p>
                    <p className="text-[11px] text-muted-foreground break-all">
                      {x402Sellers?.oracle || x402Sellers?.oracle?.toString?.() || "Loading…"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      Tip: run the backend demo script to generate a valid tx hash automatically: <span className="text-foreground">npm run x402:demo</span>
                    </p>
                  </div>

                  {/* Paid Request Playground */}
                  <div className="rounded-2xl border border-border/40 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Paid Request Playground</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Demo the full loop in the UI: call → 402 → pay → retry (XLM on Stellar testnet).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setPlaygroundStep('idle');
                          setPlaygroundTxHash(null);
                          setPlayground402(null);
                          setPlaygroundSuccess(null);
                        }}
                        className="glass-btn px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        disabled={playgroundLoading}
                        onClick={async () => {
                          const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                          setPlaygroundLoading(true);
                          try {
                            const res = await fetch(`${API_BASE_URL}/api/x402/oracle/price?symbol=XLM`);
                            const data = await res.json().catch(() => ({}));
                            setPlayground402(data);
                            if (res.status === 402) {
                              setPlaygroundStep('got_402');
                              toast.message('Got 402 Payment required (expected)');
                            } else {
                              toast.error(`Expected 402, got ${res.status}`);
                            }
                          } catch (e: any) {
                            toast.error(e?.message || 'Failed to call endpoint');
                          } finally {
                            setPlaygroundLoading(false);
                          }
                        }}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200",
                          "glass-primary text-foreground hover:text-primary",
                          playgroundStep === 'got_402' && "border border-primary/25"
                        )}
                      >
                        1) Call (expect 402)
                      </button>

                      <button
                        disabled={playgroundLoading || playgroundStep === 'idle'}
                        onClick={async () => {
                          const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                          setPlaygroundLoading(true);
                          try {
                            const payRes = await fetch(`${API_BASE_URL}/api/x402/demo/pay`, {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({ agentId: 'oracle', price: '$0.01' }),
                            });
                            const payData = await payRes.json();
                            if (!payRes.ok || !payData.success) throw new Error(payData.error || 'Payment failed');
                            setPlaygroundTxHash(payData.txHash);
                            setPlaygroundStep('paid');
                            toast.success('Payment sent', { description: `${payData.txHash.slice(0, 8)}…` });

                            const retryRes = await fetch(`${API_BASE_URL}/api/x402/oracle/price?symbol=XLM`, {
                              headers: { 'x402-tx-hash': payData.txHash },
                            });
                            const retryData = await retryRes.json().catch(() => ({}));
                            if (!retryRes.ok) throw new Error(retryData.error || `Retry failed (${retryRes.status})`);
                            setPlaygroundSuccess(retryData);
                            setPlaygroundStep('success');
                          } catch (e: any) {
                            toast.error(e?.message || 'Pay + retry failed');
                          } finally {
                            setPlaygroundLoading(false);
                          }
                        }}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200",
                          playgroundStep === 'idle'
                            ? "opacity-40 cursor-not-allowed glass-btn text-muted-foreground"
                            : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25"
                        )}
                      >
                        2) Pay + Retry (demo)
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border/40 bg-black/30 p-3">
                        <p className="text-[11px] font-semibold text-foreground mb-2">402 response</p>
                        <pre className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-auto">
{JSON.stringify(playground402, null, 2) || "{}"}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-border/40 bg-black/30 p-3">
                        <p className="text-[11px] font-semibold text-foreground mb-2">Success response</p>
                        {playgroundTxHash && (
                          <p className="text-[11px] text-muted-foreground mb-2 break-all">
                            Receipt (tx hash):{" "}
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${playgroundTxHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-foreground font-medium underline underline-offset-4 hover:text-primary transition-colors"
                              title="Open in Stellar Expert (testnet)"
                            >
                              {playgroundTxHash}
                            </a>
                          </p>
                        )}
                        <pre className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-auto">
{JSON.stringify(playgroundSuccess, null, 2) || "{}"}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Agent grid ─────────────────────────────────────────── */}
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card p-5 animate-pulse" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="h-10 w-10 rounded-xl bg-muted/40 mb-3" />
                  <div className="h-4 bg-muted/40 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted/30 rounded w-full mb-1" />
                  <div className="h-3 bg-muted/20 rounded w-4/5" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground/60 text-sm">No agents match your search.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-fade-in-up delay-300">
              {filtered.map((provider, idx) => {
                const meta       = AGENT_META[provider.id] ?? { icon: Zap, color: '#888', gradient: 'from-white/5 to-white/0' };
                const Icon       = meta.icon;
                const isConnected = connectedProviderId === provider.id;

                return (
                  <div
                    key={provider.id}
                    className="glass-card glass-shimmer p-5 flex flex-col gap-4 group animate-fade-in-up"
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between">
                      {/* Icon box */}
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br', meta.gradient)}
                        style={{ border: `1px solid ${meta.color}25` }}>
                        <Icon className="w-4.5 h-4.5" style={{ color: meta.color }} />
                      </div>

                      {/* Badges */}
                      <div className="flex gap-1.5">
                        {provider.popular && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full"
                            style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}25` }}>
                            Popular
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-secondary text-muted-foreground">
                          {provider.category}
                        </span>
                      </div>
                    </div>

                    {/* Name + description */}
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">
                        {provider.name}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed truncate-2">
                        {provider.description}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3" style={{ color: provider.rating > 0 ? '#fbbf24' : undefined }} />
                        <span className="text-foreground font-medium">{provider.rating || '—'}</span>
                        {provider.reviews > 0 && <span className="text-muted-foreground/50">({provider.reviews})</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {provider.responseTime}
                      </span>
                    </div>

                    {/* x402 price + connect */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/20 mt-auto">
                      <div>
                        <p className="text-base font-semibold text-foreground">${provider.price}</p>
                        <p className="text-[10px] text-muted-foreground/50">USDC per call</p>
                      </div>

                      <button
                        id={`connect-agent-${provider.id}`}
                        onClick={() => handleConnect(provider)}
                        className={cn(
                          'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200',
                          isConnected
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25'
                            : 'glass-primary text-foreground hover:text-primary'
                        )}
                      >
                        {isConnected ? '✓ Connected' : (
                          <>View <ArrowRight className="w-3 h-3" /></>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
