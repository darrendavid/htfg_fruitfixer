import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AdminStats } from '@/types/api';

interface TodayActivityProps {
  stats: AdminStats;
}

export function TodayActivity({ stats }: TodayActivityProps) {
  const total = stats.today_by_user.reduce((sum, u) => sum + u.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today's Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {stats.today_by_user.map((u) => (
            <div key={u.user_id} className="flex justify-between text-sm">
              <span>{u.first_name} {u.last_name}</span>
              <span className="text-muted-foreground">{u.count} reviewed</span>
            </div>
          ))}
          {stats.today_by_user.length > 0 && (
            <div className="flex justify-between text-sm font-medium border-t pt-1 mt-1">
              <span>Total</span>
              <span>{total} today</span>
            </div>
          )}
          {stats.today_by_user.length === 0 && <p className="text-sm text-muted-foreground">No activity today.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
