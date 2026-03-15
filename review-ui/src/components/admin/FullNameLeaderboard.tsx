import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LeaderboardEntry } from '@/types/api';

interface FullNameLeaderboardProps {
  entries: LeaderboardEntry[];
}

export function FullNameLeaderboard({ entries }: FullNameLeaderboardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leaderboard (Full Names)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map((entry) => (
            <div key={entry.user_id} className="flex justify-between text-sm">
              <span><span className="text-muted-foreground mr-2">{entry.rank}.</span>{entry.display_name}</span>
              <span className="text-muted-foreground">{entry.count.toLocaleString()}</span>
            </div>
          ))}
          {entries.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
