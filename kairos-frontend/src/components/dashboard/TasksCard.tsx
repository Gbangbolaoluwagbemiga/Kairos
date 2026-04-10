import { Activity } from 'lucide-react';

interface TasksCardProps {
  count: number;
}

export function TasksCard({ count }: TasksCardProps) {
  return (
    <div className="liquid-glass-card liquid-glass-shimmer p-5">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-secondary rounded-lg">
          <Activity className="w-5 h-5 text-foreground" />
        </div>
      </div>
      <p className="text-muted-foreground text-sm font-medium">Tasks Completed</p>
      <h3 className="text-2xl font-medium text-foreground mt-1">{count.toLocaleString()}</h3>
      <p className="text-xs text-muted-foreground mt-2">All time activity</p>
    </div>
  );
}
