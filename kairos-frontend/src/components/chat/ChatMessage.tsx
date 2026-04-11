import { cn } from '@/lib/utils';
import { Copy, ThumbsUp, ThumbsDown, Check, User, Bot, ExternalLink, Image as ImageIcon, BookOpen } from 'lucide-react';
import type { RagSourceRef } from '@/contexts/ChatContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, useEffect } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { PaymentPulse } from './PaymentPulse';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const AGENT_COLORS: Record<string, { bg: string; dot: string; label: string }> = {
  oracle:     { bg: '#a78bfa18', dot: '#a78bfa', label: 'Price Oracle'    },
  news:       { bg: '#60a5fa18', dot: '#60a5fa', label: 'News Scout'      },
  scout:      { bg: '#34d39918', dot: '#34d399', label: 'Chain Scout'     },
  yield:      { bg: '#fbbf2418', dot: '#fbbf24', label: 'Yield Optimizer' },
  tokenomics: { bg: '#f4727218', dot: '#f47272', label: 'Tokenomics'      },
  nft:        { bg: '#e879f918', dot: '#e879f9', label: 'NFT Scout'       },
  perp:       { bg: '#38bdf818', dot: '#38bdf8', label: 'Perp Stats'      },
};

interface ChatMessageProps {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  imagePreview?: string;
  agentsUsed?: string[];
  txHashes?: Record<string, string>;
  partial?: boolean;
  ragSources?: RagSourceRef[];
  onContinue?: () => void;
}

export function ChatMessage({ id, content, isUser, timestamp, imagePreview, agentsUsed, txHashes, partial, ragSources, onContinue }: ChatMessageProps) {
  const { address } = useWallet();
  const [rating, setRating]   = useState<boolean | null>(null);
  const [isRating, setIsRating] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [showRag, setShowRag] = useState(false);

  useEffect(() => {
    if (!isUser && agentsUsed && agentsUsed.length > 0) {
      setShowPulse(true);
      const timer = setTimeout(() => setShowPulse(false), 4500); // Hide sooner
      return () => clearTimeout(timer);
    }
  }, [isUser, agentsUsed]);

  const hadImage    = imagePreview === '[Image]' || content === '[Image attached]';
  const canShowImage = imagePreview && imagePreview.startsWith('data:');
  // Only show Continue when the model explicitly asks for a follow-up turn (not generic partial footers).
  const isPartialMessage = !!partial && content.includes('Say **continue**');

  useEffect(() => {
    if (!isUser && address && id) {
      fetch(`${API_BASE_URL}/ratings/${id}?wallet=${address}`)
        .then(r => r.json())
        .then(d => { if (d.rating !== null) setRating(d.rating); })
        .catch(() => {});
    }
  }, [id, address, isUser]);

  const handleRate = async (isPositive: boolean) => {
    if (!address || rating !== null || isRating) return;
    setIsRating(true);
    try {
      const agentId = agentsUsed?.[0] ?? undefined;
      const res = await fetch(`${API_BASE_URL}/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id, wallet: address, isPositive, agentId }),
      });
      const d = await res.json();
      if (d.success) setRating(isPositive);
    } catch (e) { console.error('Rate error:', e); }
    finally { setIsRating(false); }
  };

  return (
    <div className={cn('flex gap-3 animate-fade-in-up max-w-3xl mx-auto w-full px-4', isUser && 'flex-row-reverse')}>

      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
        isUser
          ? 'bg-primary/15 border border-primary/20'
          : 'bg-gradient-to-br from-violet-500 via-purple-600 to-blue-500 shadow-[0_0_16px_hsl(258_85%_65%/0.3)]'
      )}>
        {isUser
          ? <User  className="w-3.5 h-3.5 text-primary" />
          : <Bot   className="w-3.5 h-3.5 text-white" />
        }
      </div>

      {/* Bubble */}
      <div className={cn('flex-1 min-w-0 space-y-1.5', isUser && 'items-end flex flex-col')}>

        {/* Payment Pulse (Winning Feature) */}
        {!isUser && agentsUsed && agentsUsed.length > 0 && (
          <PaymentPulse agents={agentsUsed} isVisible={showPulse} />
        )}

        {/* Agents used pill row */}
        {!isUser && ragSources && ragSources.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1">
            <span
              className="inline-flex items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold uppercase tracking-wide bg-violet-500/15 text-violet-300 border border-violet-500/35"
              title="This reply was augmented with retrieved excerpts from kairos-backend/rag-corpus"
            >
              <BookOpen className="w-3 h-3 opacity-90" />
              RAG · {ragSources.length} source{ragSources.length > 1 ? 's' : ''}
            </span>
          </div>
        )}

        {!isUser && agentsUsed && agentsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {agentsUsed.map((agentId) => {
              const meta = AGENT_COLORS[agentId] ?? { bg: '#ffffff10', dot: '#888', label: agentId };
              const txHash = txHashes?.[agentId];
              
              if (txHash) {
                return (
                  <div key={agentId} className="flex items-center gap-1">
                    <a 
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="agent-badge hover:brightness-125 transition-all group cursor-pointer flex items-center gap-1.5 py-1 px-2.5" 
                      style={{ 
                        background: `linear-gradient(to right, ${meta.bg}, ${meta.dot}10)`, 
                        borderColor: `${meta.dot}40`, 
                        color: meta.dot,
                        boxShadow: `0 0 10px ${meta.dot}15`
                      }}
                      title="View USDC Micropayment on StellarExpert"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-500"></span>
                      </span>
                      <span className="font-semibold text-[10px] tracking-wide uppercase">{meta.label}</span>
                      <span className="text-[9px] bg-sky-500/20 px-1 rounded text-sky-400 border border-sky-500/30">0.01 USDC</span>
                      <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </a>
                    
                    {/* Soroban Badge */}
                    <div 
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[8px] text-violet-300 font-medium uppercase tracking-tighter"
                      title="On-chain Agent Registry Verified"
                    >
                      <Check className="w-2 h-2 text-violet-400" />
                      Soroban
                    </div>
                  </div>
                );
              }

              return (
                <span key={agentId} className="agent-badge" style={{ background: meta.bg, borderColor: `${meta.dot}30`, color: meta.dot }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />
                  {meta.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Image */}
        {canShowImage && (
          <div className={cn('mb-1', isUser && 'flex justify-end')}>
            <img src={imagePreview} alt="Uploaded" className="max-h-48 rounded-xl border border-border/40" />
          </div>
        )}
        {hadImage && !canShowImage && (
          <div className={cn('mb-1 flex items-center gap-2 px-3 py-2 rounded-xl glass-card text-muted-foreground text-xs', isUser && 'ml-auto')}>
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Image attached</span>
          </div>
        )}

        {/* Text content */}
        {content && (
          <div className={cn(
            'chat-prose',
            isUser && [
              'glass-primary px-4 py-3 text-sm text-foreground rounded-2xl rounded-tr-sm',
              'prose prose-sm dark:prose-invert max-w-none',
            ]
          )}>
            {isUser ? (
              <p className="m-0 text-sm leading-relaxed">{content}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer"
                      className="text-[hsl(195_90%_55%)] hover:underline inline-flex items-center gap-0.5">
                      {children}
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  ),
                  code: ({ children, className }) => {
                    const text = String(children).trim();
                    const isUrl = /^(https?:\/\/|www\.)|(\.[a-z]{2,}(\/|$))/i.test(text);
                    if (isUrl && !className) {
                      return (
                        <a href={text.startsWith('http') ? text : `https://${text}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[hsl(195_90%_55%)] hover:underline">
                          {text}
                        </a>
                      );
                    }
                    return <code className="text-[hsl(195_90%_60%)] bg-[hsl(195_90%_55%/0.08)] px-1.5 py-0.5 rounded text-[0.85em]">{children}</code>;
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            )}
          </div>
        )}

        {!isUser && ragSources && ragSources.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowRag((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/80 hover:text-violet-300/90 transition-colors"
            >
              <BookOpen className="w-3 h-3 opacity-70" />
              {showRag ? 'Hide sources' : `${ragSources.length} knowledge source${ragSources.length > 1 ? 's' : ''}`}
            </button>
            {showRag && (
              <ul className="mt-1.5 space-y-1.5 pl-0.5 border-l border-violet-500/20 ml-1 py-1">
                {ragSources.map((s, i) => (
                  <li key={`${s.source}-${i}`} className="text-[10px] text-muted-foreground/90 leading-snug list-none">
                    <span className="text-violet-400/90 font-medium">[{s.source}]</span>{' '}
                    <span className="opacity-80">score {s.score}</span>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-flex items-center gap-0.5 text-sky-400/90 hover:underline"
                      >
                        open
                        <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                      </a>
                    )}
                    <span className="block mt-0.5 text-muted-foreground/70">{s.excerpt}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Timestamp + rating */}
        <div className={cn('flex items-center gap-2', isUser && 'justify-end')}>
          <span className="text-[10px] text-muted-foreground/40">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>

          {!isUser && isPartialMessage && onContinue && (
            <button
              onClick={onContinue}
              className="ml-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
              title="Continue fetching remaining agents"
            >
              Continue
            </button>
          )}

          {!isUser && (
            <div className="flex items-center gap-0.5">
              {rating === null ? (
                <>
                  <button onClick={() => handleRate(true)} disabled={isRating}
                    className="p-1 text-muted-foreground/40 hover:text-emerald-400 transition-colors disabled:opacity-30" title="Good response">
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button onClick={() => handleRate(false)} disabled={isRating}
                    className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors disabled:opacity-30" title="Bad response">
                    <ThumbsDown className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div className={cn('p-1', rating ? 'text-emerald-400' : 'text-red-400')}>
                  {rating ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
