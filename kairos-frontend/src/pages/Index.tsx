import { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { useChat } from '@/hooks/useChat';
import { useWallet } from '@/contexts/WalletContext';
import { Zap, Bot, TrendingUp, BarChart3, Newspaper, Coins, ArrowRight } from 'lucide-react';

const AGENT_PROMPTS = [
  { icon: TrendingUp, label: 'Price Oracle', prompt: 'What is the current price and all-time high (ATH) of XLM?', color: 'hsl(258 85% 65%)' },
  { icon: Newspaper, label: 'News Scout', prompt: 'What are the latest major crypto news headlines?', color: 'hsl(195 90% 55%)' },
  { icon: BarChart3, label: 'Chain Scout', prompt: 'What are the top DeFi protocols by TVL right now?', color: 'hsl(152 60% 52%)' },
  { icon: Coins, label: 'Yield Optimizer', prompt: 'What are the best USDC yield opportunities across DeFi?', color: 'hsl(42 92% 58%)' },
];

const FEATURED_AGENTS = [
  { id: 'oracle', name: 'Price Oracle', desc: 'Live prices, ATH, and market peaks', price: '0.01', color: '#a78bfa' },
  { id: 'news',   name: 'News Scout',   desc: 'Real-time news & sentiment', price: '0.01', color: '#60a5fa' },
  { id: 'scout',  name: 'Chain Scout',  desc: 'On-chain analytics & TVL',    price: '0.02', color: '#34d399' },
  { id: 'yield',  name: 'Yield Optimizer', desc: 'DeFi APY aggregator',      price: '0.01', color: '#fbbf24' },
  { id: 'tokenomics', name: 'Tokenomics Analyzer', desc: 'Supply & unlock intelligence', price: '0.01', color: '#f47272' },
  { id: 'stellar-scout', name: 'Stellar Scout', desc: 'SDEX + Stellar DeFi analytics', price: '0.02', color: '#22d3ee' },
  { id: 'perp', name: 'Perp Stats', desc: 'Funding, OI and perp market heat', price: '0.02', color: '#38bdf8' },
  { id: 'protocol', name: 'Protocol Stats', desc: 'TVL, fees, revenue by protocol', price: '0.01', color: '#fb7185' },
  { id: 'bridges', name: 'Bridge Monitor', desc: 'Cross-chain bridge flow tracking', price: '0.01', color: '#c084fc' },
];

const Index = () => {
  const { messages, isTyping, isPaying, sendMessage } = useChat();
  const { isConnected } = useWallet();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (location.state?.providerName) {
      toast.success(`Connected to ${location.state.providerName}`);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const isEmpty = messages.length === 0;

  return (
    <Layout>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto scrollbar-hidden">
          {isEmpty ? (
            <HeroState onSend={sendMessage} isConnected={isConnected} />
          ) : (
            <div className="py-8 space-y-6">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  id={message.id}
                  content={message.content}
                  isUser={message.isUser}
                  timestamp={message.timestamp}
                  imagePreview={message.imagePreview}
                  agentsUsed={message.agentsUsed}
                  txHashes={message.txHashes}
                  partial={message.partial}
                  onContinue={() => sendMessage('continue')}
                />
              ))}

              {isPaying && (
                <div className="px-4 max-w-3xl mx-auto">
                  <div className="glass-card p-3 flex items-center gap-3">
                    <div className="status-dot-payment flex-shrink-0" />
                    <div className="flex-1">
                      <div className="payment-flow-line" />
                    </div>
                    <span className="text-xs text-muted-foreground">Signing payment...</span>
                  </div>
                </div>
              )}
              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input — fixed at bottom */}
        <div className="sticky bottom-0 z-30 bg-background/80 backdrop-blur-xl pb-4 pt-2 border-t border-border/30">
          <ChatInput onSend={sendMessage} disabled={!isConnected || isTyping || isPaying} />
        </div>
      </div>
    </Layout>
  );
};

/* ─── Hero state (empty chat) ─────────────────────────────────────────── */
function HeroState({ onSend, isConnected }: { onSend: (msg: string) => void; isConnected: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-4 py-12 space-y-10">

      {/* Brand mark */}
      <div className="text-center space-y-4 animate-fade-in-up">
        {/* Logo orb */}
        <div className="relative mx-auto w-20 h-20 mb-2">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-blue-600 flex items-center justify-center shadow-[0_0_60px_hsl(258_85%_65%/0.4)] animate-glow">
            <Bot className="w-9 h-9 text-white" />
          </div>
          {/* Orbit dot */}
          <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-yellow-400 shadow-[0_0_8px_hsl(42_92%_58%/0.8)] animate-orbit" />
        </div>

        <div>
          <h1 className="text-5xl md:text-6xl font-display font-semibold leading-tight">
            <span className="kairos-gradient">Kairos</span>
          </h1>
          <p className="mt-3 text-lg text-muted-foreground max-w-md mx-auto text-balance">
            Your multi-agent crypto AI. Powered by{' '}
            <span className="text-[hsl(195_90%_55%)] font-medium">Stellar x402</span>.
            Pay only for what you ask.
          </p>
        </div>

        {/* Live stat pills */}
        <div className="flex flex-wrap justify-center gap-2 mt-1">
          <span className="glass-btn px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="status-dot" />
            9 agents online
          </span>
          <span className="glass-btn px-3 py-1.5 text-xs text-muted-foreground">
            <span className="payment-gradient font-semibold">$0.03</span> per query
          </span>
          <span className="glass-btn px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-yellow-400" />
            Stellar Testnet
          </span>
        </div>
      </div>

      {/* Agent quick-start grid */}
      <div className="w-full max-w-2xl animate-slide-up delay-200">
        <p className="text-xs text-muted-foreground text-center mb-3 uppercase tracking-widest">Try an agent</p>
        <div className="grid grid-cols-2 gap-2">
          {AGENT_PROMPTS.map(({ icon: Icon, label, prompt, color }) => (
            <button
              key={label}
              onClick={() => isConnected && onSend(prompt)}
              disabled={!isConnected}
              className="glass-card glass-shimmer p-4 text-left group disabled:opacity-40 disabled:cursor-not-allowed"
              id={`quick-${label.toLowerCase().replace(' ', '-')}`}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate-2 leading-relaxed">{prompt}</p>
                </div>
              </div>
              <div className="flex items-center justify-end mt-2">
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Featured agents mini-row */}
      <div className="w-full max-w-2xl animate-slide-up delay-300">
        <p className="text-xs text-muted-foreground text-center mb-3 uppercase tracking-widest">Active agents</p>
        <div className="flex gap-2 overflow-x-auto scrollbar-hidden pb-1">
          {FEATURED_AGENTS.map((agent) => (
            <div key={agent.id} className="glass-card flex-shrink-0 px-3 py-2 flex items-center gap-2 min-w-[160px]">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.color, boxShadow: `0 0 6px ${agent.color}99` }} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{agent.name}</p>
                <p className="text-[10px] text-muted-foreground">${agent.price} USDC/call</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!isConnected && (
        <p className="text-xs text-muted-foreground animate-fade-in delay-400">
          Connect your Stellar wallet to start querying agents
        </p>
      )}
    </div>
  );
}

export default Index;
