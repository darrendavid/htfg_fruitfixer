import { Progress } from '@/components/ui/progress';

interface OverallProgressProps {
  completed: number;
  total: number;
}

export function OverallProgress({ completed, total }: OverallProgressProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">Overall Progress</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="h-3" />
      <p className="text-sm text-muted-foreground">
        {completed.toLocaleString()} / {total.toLocaleString()} reviewed
      </p>
    </div>
  );
}
