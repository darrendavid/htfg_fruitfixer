import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { AdminStats } from '@/types/api';

interface QueueStatusCardsProps {
  stats: AdminStats;
}

export function QueueStatusCards({ stats }: QueueStatusCardsProps) {
  const swipeTotal = stats.swipe_pending + stats.swipe_in_progress + stats.swipe_completed;
  const classifyTotal = stats.classify_pending + stats.classify_in_progress + stats.classify_completed + stats.classify_flagged_idk;
  const swipePct = swipeTotal > 0 ? Math.round((stats.swipe_completed / swipeTotal) * 100) : 0;
  const classifyPct = classifyTotal > 0 ? Math.round((stats.classify_completed / classifyTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Swipe Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={swipePct} className="h-2" />
          <p className="text-xs text-muted-foreground">{stats.swipe_completed.toLocaleString()} / {swipeTotal.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Classify Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={classifyPct} className="h-2" />
          <p className="text-xs text-muted-foreground">{stats.classify_completed.toLocaleString()} / {classifyTotal.toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  );
}
