interface PolicyLimitsProps {
  dailyLimit: number;
  dailySpent: number;
}

export function PolicyLimits({ dailyLimit, dailySpent }: PolicyLimitsProps) {
  const percentage = Math.min((dailySpent / dailyLimit) * 100, 100);
  const remaining = dailyLimit - dailySpent;

  return (
    <div className="liquid-glass-card liquid-glass-shimmer p-5">
      <div className="flex justify-between items-center mb-2">
        <p className="text-muted-foreground text-sm font-medium">Daily Spend Limit</p>
        <span className="text-foreground font-bold">${dailyLimit.toFixed(2)}</span>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>${dailySpent.toFixed(2)} spent</span>
          <span>${remaining.toFixed(2)} remaining</span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
          <div 
            className="bg-primary h-full rounded-full transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
