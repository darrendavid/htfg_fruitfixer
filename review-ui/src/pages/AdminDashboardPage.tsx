import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QueueStatusCards } from '@/components/admin/QueueStatusCards';
import { DecisionBreakdown } from '@/components/admin/DecisionBreakdown';
import { FullNameLeaderboard } from '@/components/admin/FullNameLeaderboard';
import { TodayActivity } from '@/components/admin/TodayActivity';
import { RerunBanner } from '@/components/admin/RerunBanner';
import { CompletionLog } from '@/components/admin/CompletionLog';
import { UsersTable } from '@/components/admin/UsersTable';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { AdminStats, LeaderboardEntry, QueueItem } from '@/types/api';

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [idkFlagged, setIdkFlagged] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      const [statsRes, lbRes] = await Promise.all([
        fetch('/api/admin/stats', { credentials: 'include' }),
        fetch('/api/admin/leaderboard', { credentials: 'include' }),
      ]);
      const [statsData, lbData] = await Promise.all([statsRes.json(), lbRes.json()]);
      setStats(statsData.stats ?? null);
      setLeaderboard(lbData.leaderboard ?? []);
    } catch {} finally {
      setIsLoading(false);
    }
  }

  async function loadIdkFlagged() {
    try {
      const res = await fetch('/api/admin/idk-flagged', { credentials: 'include' });
      const data = await res.json();
      setIdkFlagged(data.images ?? []);
    } catch {}
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AdminGuard>
      <AppShell title="Admin Dashboard">
        <div className="p-4">
          <Tabs defaultValue="overview">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
              <TabsTrigger value="log" className="flex-1 text-xs">Log</TabsTrigger>
              <TabsTrigger value="idk" className="flex-1 text-xs" onClick={loadIdkFlagged}>IDK</TabsTrigger>
              <TabsTrigger value="users" className="flex-1 text-xs">Users</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : stats ? (
                <div className="space-y-4">
                  <QueueStatusCards stats={stats} />
                  <DecisionBreakdown stats={stats} />
                  <RerunBanner count={stats.new_plant_rerun_count} />
                  {stats.idk_flagged_count > 0 && (
                    <Alert>
                      <AlertDescription>
                        ⚠ Needs Expert Review: {stats.idk_flagged_count} image{stats.idk_flagged_count !== 1 ? 's' : ''} with 3+ IDK votes.{' '}
                        <button className="underline" onClick={loadIdkFlagged}>View in IDK tab</button>
                      </AlertDescription>
                    </Alert>
                  )}
                  <FullNameLeaderboard entries={leaderboard} />
                  <TodayActivity stats={stats} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Failed to load stats.</p>
              )}
            </TabsContent>

            <TabsContent value="log">
              <CompletionLog />
            </TabsContent>

            <TabsContent value="idk">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{idkFlagged.length} image(s) need expert review</p>
                {idkFlagged.map((item) => (
                  <div key={item.id} className="flex gap-3 items-center p-3 border rounded-lg">
                    {item.thumbnail_path && (
                      <img
                        src={`/thumbnails/${item.thumbnail_path.replace(/^.*?\.thumbnails[\\/]/, '')}`}
                        alt=""
                        className="w-16 h-16 object-cover rounded shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{item.image_path}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.idk_count} IDK votes</p>
                    </div>
                  </div>
                ))}
                {idkFlagged.length === 0 && (
                  <p className="text-sm text-muted-foreground">No images flagged for expert review.</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="users">
              <UsersTable />
            </TabsContent>
          </Tabs>
        </div>
      </AppShell>
    </AdminGuard>
  );
}
