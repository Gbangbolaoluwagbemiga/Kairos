import { Activity, ArrowUpRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';

const CHART_DATA = [
  { name: 'Mon', value: 0 },
  { name: 'Tue', value: 0 },
  { name: 'Wed', value: 0 },
  { name: 'Thu', value: 0 },
  { name: 'Fri', value: 0 },
  { name: 'Sat', value: 0 },
  { name: 'Sun', value: 0 },
];

interface TreasuryCardProps {
  balance: number;
  trend: number;
}

export function TreasuryCard({ balance, trend }: TreasuryCardProps) {
  return (
    <div className="liquid-glass-card liquid-glass-shimmer p-5 relative overflow-hidden group">
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="p-2 bg-secondary rounded-lg">
            <Activity className="w-5 h-5 text-foreground" />
          </div>
          <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium bg-emerald-950/30 px-2 py-1 rounded-md">
            <ArrowUpRight className="w-3 h-3" />
            +{trend}%
          </div>
        </div>
        <p className="text-muted-foreground text-sm font-medium">Treasury Balance</p>
        <h3 className="text-2xl font-medium text-foreground mt-1">${balance.toFixed(2)}</h3>
      </div>

      {/* Sparkline Background */}
      <div className="absolute bottom-0 left-0 right-0 h-24 opacity-10 group-hover:opacity-20 transition-opacity">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={CHART_DATA}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              fillOpacity={1}
              fill="url(#colorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
