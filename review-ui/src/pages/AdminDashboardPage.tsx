import { useState, useEffect, useRef } from 'react';
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
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { AdminStats, LeaderboardEntry, QueueItem } from '@/types/api';

type ImportStatus = {
  status: 'idle' | 'running' | 'complete' | 'error';
  step: string;
  progress: number;
  total: number;
  message: string;
  counts?: { plants: number; swipe: number; classify: number; total: number };
};

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [idkFlagged, setIdkFlagged] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [importStarting, setImportStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function loadImportStatus() {
    try {
      const res = await fetch('/api/admin/import-status', { credentials: 'include' });
      const data = await res.json();
      setImportStatus(data);
      if (data.status === 'running' && !pollRef.current) {
        // Import is running (possibly started before this page load) — resume polling
        pollRef.current = setInterval(loadImportStatus, 2000);
      } else if (data.status !== 'running' && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {}
  }

  async function startImport(skipThumbnails: boolean) {
    setImportStarting(true);
    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipThumbnails }),
      });
      if (res.ok || res.status === 409) {
        pollRef.current = setInterval(loadImportStatus, 2000);
        loadImportStatus();
      }
    } finally {
      setImportStarting(false);
    }
  }

  useEffect(() => {
    loadData();
    loadImportStatus();
    const interval = setInterval(loadData, 30_000);
    return () => {
      clearInterval(interval);
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
              <TabsTrigger value="import" className="flex-1 text-xs" onClick={loadImportStatus}>Import</TabsTrigger>
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

            <TabsContent value="import">
              <div className="space-y-4">
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-sm">Data Import</h3>
                  <p className="text-xs text-muted-foreground">
                    Loads plants, swipe queue, and classify queue from the Phase 4/4B JSON files.
                    Run once after initial deployment. Thumbnail generation takes 30–60 min.
                  </p>

                  {importStatus && importStatus.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{importStatus.step || importStatus.status}</span>
                        <span className={`capitalize font-medium ${importStatus.status === 'complete' ? 'text-green-600' : importStatus.status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {importStatus.status}
                        </span>
                      </div>
                      {importStatus.status === 'running' && importStatus.total > 0 && (
                        <>
                          <Progress value={Math.round((importStatus.progress / importStatus.total) * 100)} className="h-2" />
                          <p className="text-xs text-muted-foreground text-right">
                            {importStatus.progress.toLocaleString()} / {importStatus.total.toLocaleString()}
                          </p>
                        </>
                      )}
                      {importStatus.message && (
                        <p className="text-xs text-muted-foreground">{importStatus.message}</p>
                      )}
                      {importStatus.counts && (
                        <div className="text-xs grid grid-cols-2 gap-1 pt-1">
                          <span className="text-muted-foreground">Plants</span><span>{importStatus.counts.plants}</span>
                          <span className="text-muted-foreground">Swipe queue</span><span>{importStatus.counts.swipe}</span>
                          <span className="text-muted-foreground">Classify queue</span><span>{importStatus.counts.classify}</span>
                          <span className="text-muted-foreground font-medium">Total</span><span className="font-medium">{importStatus.counts.total}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => startImport(false)}
                      disabled={importStarting || importStatus?.status === 'running'}
                    >
                      {importStatus?.status === 'running' ? 'Running…' : 'Start Import'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startImport(true)}
                      disabled={importStarting || importStatus?.status === 'running'}
                    >
                      Start (skip thumbnails)
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AppShell>
    </AdminGuard>
  );
}
