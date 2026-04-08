import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';
import type { DedupGroup, DedupRecord, DedupReviewResponse } from '@/types/matches';

function sourceImgUrl(origPath: string): string {
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  return `/content-files/${encode(origPath.replace(/^content\//, ''))}`;
}

export function DedupReviewTab() {
  const [groups, setGroups] = useState<DedupGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const LIMIT = 50;

  const fetchPage = useCallback((off: number) => {
    setIsLoading(true);
    fetch(`/api/matches/dedup-review?offset=${off}&limit=${LIMIT}`, { credentials: 'include' })
      .then(r => r.json())
      .then((data: DedupReviewResponse) => {
        setGroups(data.groups);
        setTotal(data.total);
        setOffset(off);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const handleRestore = useCallback(async (group: DedupGroup, rec: DedupRecord) => {
    setRestoringId(rec.id);
    try {
      const res = await fetch('/api/matches/dedup-restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted_record: rec }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Restore failed');
      } else {
        const data = await res.json();
        toast.success(`Restored as Id:${data.new_id}`);
        // Remove from the deleted list in this group
        setGroups(prev => prev.map(g => {
          if (g.original_filepath !== group.original_filepath) return g;
          return { ...g, deleted: g.deleted.filter(d => d.id !== rec.id) };
        }));
      }
    } catch {
      toast.error('Restore failed');
    } finally {
      setRestoringId(null);
    }
  }, []);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-3 border-b bg-background">
        <h2 className="text-sm font-semibold">Dedup Review</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {total} groups of duplicates removed. Review each group — restore any incorrect deletions.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-32 w-full rounded-lg" />)}
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No dedup groups to review.</p>
        ) : (
          <>
            {groups.map((group, idx) => (
              <div key={group.original_filepath} className="border rounded-lg p-3 space-y-2">
                {/* Source path */}
                <p className="text-xs font-mono text-muted-foreground truncate select-all" title={group.original_filepath}>
                  <span className="font-semibold text-muted-foreground/70">Source:</span>{' '}
                  {group.original_filepath.replace(/^content\/source\//, '')}
                </p>

                {/* Kept record(s) */}
                <div>
                  <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1">Kept</p>
                  {group.kept.map(rec => (
                    <div key={rec.id} className="flex items-center gap-2 py-1 text-xs">
                      <div className="shrink-0 w-[60px] h-[45px] bg-muted rounded overflow-hidden">
                        <img
                          src={imgUrlFromFilePath(rec.file_path)}
                          alt=""
                          className="w-full h-full object-cover cursor-zoom-in"
                          loading="lazy"
                          onClick={() => setPreviewSrc(imgUrlFromFilePath(rec.file_path))}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{rec.file_path.split('/').pop()}</p>
                        <p className="text-muted-foreground truncate">{rec.plant_id || '(no plant)'} · {rec.status}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 shrink-0">kept</Badge>
                    </div>
                  ))}
                </div>

                {/* Deleted records */}
                {group.deleted.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">Deleted ({group.deleted.length})</p>
                    {group.deleted.map(rec => (
                      <div key={rec.id} className="flex items-center gap-2 py-1 text-xs">
                        <div className="shrink-0 w-[60px] h-[45px] bg-muted rounded overflow-hidden opacity-60">
                          <img
                            src={sourceImgUrl(group.original_filepath)}
                            alt=""
                            className="w-full h-full object-cover cursor-zoom-in"
                            loading="lazy"
                            onClick={() => setPreviewSrc(sourceImgUrl(group.original_filepath))}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{rec.file_path.split('/').pop()}</p>
                          <p className="text-muted-foreground truncate">
                            {rec.plant_id || '(no plant)'} · {rec.status}
                            {rec.variety_id ? ` · variety:${rec.variety_id}` : ''}
                            {rec.caption ? ` · "${rec.caption}"` : ''}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 shrink-0">deleted</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 shrink-0"
                          disabled={restoringId === rec.id || !rec.plant_id}
                          onClick={() => handleRestore(group, rec)}
                        >
                          {restoringId === rec.id ? '...' : 'Restore'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 pt-2 pb-4">
                <Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => fetchPage(offset - LIMIT)}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => fetchPage(offset + LIMIT)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <ImagePreviewDialog
        src={previewSrc}
        alt="Dedup review image"
        open={!!previewSrc}
        onOpenChange={(open) => { if (!open) setPreviewSrc(null); }}
      />
    </div>
  );
}
