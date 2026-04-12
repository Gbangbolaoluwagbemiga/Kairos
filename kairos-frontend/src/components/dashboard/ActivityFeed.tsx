import { useState, useEffect } from 'react';
import { ArrowDownLeft, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const STELLAR_EXPERT_TX = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

interface Activity {
  id: string;
  type: string;
  timestamp: string;
  action?: 'received' | 'sent';
  responseTimeMs: number;
  /** Legacy field from older API */
  amount?: number;
  /** Nominal USDC-equivalent credit (dashboard math), not always what the tx used */
  nominalUsd?: number;
  txHash?: string;
  /** Parsed from Horizon when txHash is present */
  onChain?: { code: string; amount: string } | null;
}

interface ActivityFeedProps {
  agentId?: string | null;
}

export function ActivityFeed({ agentId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchActivities = async () => {
      if (!agentId || agentId === 'undefined') return;


      setLoading(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const response = await fetch(`${API_BASE_URL}/dashboard/activity?agentId=${agentId}&limit=10`);
        const data = await response.json();
        if (data.activities) {
          setActivities(data.activities);
        }
      } catch (error) {
        console.error('Failed to fetch activities:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
    // Refresh every 10 seconds
    const interval = setInterval(fetchActivities, 10000);
    return () => clearInterval(interval);
  }, [agentId]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const shortTx = (txHash: string) => {
    if (txHash.length <= 14) return txHash;
    return `${txHash.slice(0, 8)}...${txHash.slice(-6)}`;
  };

  return (
    <div className="liquid-glass-card liquid-glass-shimmer p-5 h-full">
      <h3 className="text-lg font-medium text-foreground mb-6">Recent Activity</h3>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {loading && activities.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">Loading...</p>
        ) : activities.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">No queries yet. Start using this agent to see activity.</p>
        ) : (
          activities.map((activity) => {
            const nominal = activity.nominalUsd ?? activity.amount ?? 0;
            const creditLine = activity.onChain
              ? `+${activity.onChain.amount} ${activity.onChain.code}`
              : `+~$${Number(nominal).toFixed(2)} nominal`;
            return (
            <div
              key={activity.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-border/40 bg-secondary/20 hover:bg-secondary/35 transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center bg-secondary shrink-0",
                  "text-emerald-400"
                )}>
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium capitalize">{activity.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(activity.timestamp)} • {(activity.responseTimeMs / 1000).toFixed(1)}s response
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-stretch sm:items-end gap-2 sm:min-w-[200px]">
                <div
                  className="font-semibold text-sm text-emerald-400 text-right"
                  title={
                    activity.onChain
                      ? 'First payment operation in this transaction'
                      : 'Nominal USDC-equivalent; open tx to see if settlement was USDC or XLM'
                  }
                >
                  {creditLine}
                </div>
                {activity.txHash ? (
                  <a
                    href={STELLAR_EXPERT_TX(activity.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium',
                      'bg-stellar/15 text-stellar border border-stellar/30 hover:bg-stellar/25 transition-colors'
                    )}
                  >
                    <span className="font-mono text-[10px] opacity-90 truncate max-w-[200px]">
                      {shortTx(activity.txHash)}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    <span className="sr-only">Open transaction on StellarExpert</span>
                  </a>
                ) : (
                  <span className="text-[10px] text-muted-foreground/70 text-right">
                    No on-chain match in window (refresh after payments settle)
                  </span>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
