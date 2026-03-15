import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { OverallProgress } from '@/components/leaderboard/OverallProgress';
import { MyStats } from '@/components/leaderboard/MyStats';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import type { LeaderboardEntry, UserStats, QueueStats } from '@/types/api';

export function LeaderboardPage() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myStats, setMyStats] = useState<UserStats | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      const [lbRes, statsRes, qRes] = await Promise.all([
        fetch('/api/leaderboard', { credentials: 'include' }),
        fetch('/api/me/stats', { credentials: 'include' }),
        fetch('/api/queue/stats', { credentials: 'include' }),
      ]);
      const [lbData, statsData, qData] = await Promise.all([
        lbRes.json(),
        statsRes.json(),
        qRes.json(),
      ]);
      setLeaderboard(lbData.leaderboard ?? []);
      setMyStats(statsData);
      setQueueStats(qData.stats ?? null);
    } catch {} finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // Poll every 30 seconds
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const totalCompleted = queueStats
    ? (queueStats.swipe_completed + queueStats.classify_completed)
    : 0;
  const totalItems = queueStats
    ? (queueStats.swipe_pending + queueStats.swipe_in_progress + queueStats.swipe_completed +
       queueStats.classify_pending + queueStats.classify_in_progress + queueStats.classify_completed)
    : 0;

  return (
    <AuthGuard>
      <AppShell title="Leaderboard">
        <div className="p-4 space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              <OverallProgress completed={totalCompleted} total={totalItems} />
              {myStats && <MyStats stats={myStats} />}
              <LeaderboardTable entries={leaderboard} currentUser={user} />
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
