import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UserStats } from '@/types/api';

interface MyStatsProps {
  stats: UserStats;
}

export function MyStats({ stats }: MyStatsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your Stats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm">Today: <span className="font-semibold">{stats.today_count}</span> reviewed</p>
        <p className="text-sm">All time: <span className="font-semibold">{stats.all_time_count.toLocaleString()}</span> reviewed</p>
        <p className="text-sm">Rank: <span className="font-semibold">#{stats.rank}</span></p>
      </CardContent>
    </Card>
  );
}
