import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ThumbSizeToggle } from '@/components/ui/thumb-size-toggle';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';

const GRID_CLASSES = {
  lg: 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2',
  md: 'grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-8 gap-2',
  sm: 'grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-12 gap-2',
} as const;

export function UnassignedTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [thumbSize, setThumbSize] = useState<'lg' | 'md' | 'sm'>('md');
  const LIMIT = 100;

  const fetchPage = useCallback((off: number) => {
    setIsLoading(true);
    fetch(`/api/matches/unassigned-images-list?offset=${off}&limit=${LIMIT}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setItems(data.items);
        setTotal(data.total);
        setOffset(off);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  function imgUrl(filePath: string): string {
    const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
    if (filePath.startsWith('content/pass_01/assigned/'))
      return `/images/${encode(filePath.replace('content/pass_01/assigned/', ''))}`;
    if (filePath.startsWith('content/pass_01/unassigned/'))
      return `/unassigned-images/${encode(filePath.replace('content/pass_01/unassigned/', ''))}`;
    return `/content-files/${encode(filePath.replace(/^content\//, ''))}`;
  }

  const handleImageClick = useCallback((e: React.MouseEvent, item: any, idx: number) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      e.preventDefault();
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) if (items[i]) next.add(items[i].Id);
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.Id)) next.delete(item.Id);
        else next.add(item.Id);
        return next;
      });
      setLastClickedIdx(idx);
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.Id)) next.delete(item.Id);
        else next.add(item.Id);
        return next;
      });
      setLastClickedIdx(idx);
    }
  }, [lastClickedIdx, items]);

  const handleAssign = useCallback(async (plant: PlantSuggestion) => {
    if (selectedIds.size === 0) return;
    try {
      const ids = [...selectedIds];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await fetch('/api/browse/bulk-reassign-images', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, plant_id: plant.Id1 }),
        });
        if (!res.ok) { toast.error('Assignment failed at batch ' + i); return; }
      }
      toast.success(`Assigned ${ids.length} images to ${plant.Canonical_Name}`);
      setSelectedIds(new Set());
      fetchPage(offset);
    } catch { toast.error('Assignment failed'); }
  }, [selectedIds, offset, fetchPage]);

  const handleSendToTriage = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = [...selectedIds];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await fetch('/api/browse/bulk-set-status', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, status: 'triage' }),
        });
        if (!res.ok) { toast.error('Failed at batch ' + i); return; }
      }
      toast.success(`Sent ${ids.length} images to Triage`);
      setSelectedIds(new Set());
      fetchPage(offset);
    } catch { toast.error('Failed'); }
  }, [selectedIds, offset, fetchPage]);

  const handleHide = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = [...selectedIds];
      // Batch in groups of 50 to avoid overloading NocoDB
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await fetch('/api/browse/bulk-set-status', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, status: 'hidden' }),
        });
        if (!res.ok) { toast.error('Failed at batch ' + i); return; }
      }
      toast.success(`Hidden ${ids.length} images`);
      setSelectedIds(new Set());
      fetchPage(offset); // Re-fetch current page
    } catch { toast.error('Failed'); }
  }, [selectedIds, offset, fetchPage]);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 p-3 border-b bg-background flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">No Plant Assignment</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{total} images with no plant assigned.</p>
        </div>
        <ThumbSizeToggle value={thumbSize} onChange={setThumbSize} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(n => <Skeleton key={n} className="h-20 w-full rounded-lg" />)}</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No unassigned images.</p>
        ) : (
          <>
            <div className={GRID_CLASSES[thumbSize]}>
              {items.map((item, idx) => {
                const isSel = selectedIds.has(item.Id);
                return (
                  <div key={item.Id} className="space-y-1">
                    <div
                      className={`aspect-square bg-muted rounded overflow-hidden cursor-pointer relative ${isSel ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'}`}
                      onClick={(e) => handleImageClick(e, item, idx)}
                    >
                      <img
                        src={imgUrl(item.File_Path)}
                        alt={item.Caption ?? ''}
                        loading="lazy"
                        className={`w-full h-full object-cover ${isSel ? 'opacity-75' : ''}`}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      {isSel && (
                        <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
                      )}
                      <button
                        className="absolute bottom-0.5 right-0.5 z-10 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); setPreviewSrc(imgUrl(item.File_Path)); }}
                        title="Preview"
                      >🔍</button>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate" title={item.File_Path}>
                      {item.File_Path.split('/').pop()}
                    </p>
                    {item.Original_Filepath && (
                      <p className="text-[9px] text-muted-foreground/60 truncate" title={item.Original_Filepath}>
                        {item.Original_Filepath.replace(/^content\/source\//, '').split('/').slice(-2).join('/')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 pt-4">
                <Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => fetchPage(offset - LIMIT)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => fetchPage(offset + LIMIT)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Assignment bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-12 left-0 right-0 z-50 bg-blue-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>
            <div className="flex-1 max-w-[300px]">
              <PlantAutocomplete
                label=""
                placeholder="Assign to plant..."
                inputClassName="h-6 text-xs bg-white text-black"
                dropdownLeftClass="left-0"
                onSelect={handleAssign}
                onCreateAndSelect={async (name, slug) => handleAssign({ Id: 0, Id1: slug, Canonical_Name: name })}
                createMessage={(name) => `Create "${name}" and assign ${selectedIds.size} images?`}
                createLabel="Create & Assign"
              />
            </div>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-2" onClick={handleSendToTriage}>
              Triage
            </Button>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-2 bg-red-100 hover:bg-red-200 text-red-800" onClick={handleHide}>
              Hide
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
              onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
