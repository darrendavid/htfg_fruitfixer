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

interface HiddenGroup { plant_id: string; plant_name: string; count: number; }

function imgUrl(filePath: string): string {
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  if (filePath.startsWith('content/pass_01/assigned/'))
    return `/images/${encode(filePath.replace('content/pass_01/assigned/', ''))}`;
  if (filePath.startsWith('content/pass_01/unassigned/'))
    return `/unassigned-images/${encode(filePath.replace('content/pass_01/unassigned/', ''))}`;
  return `/content-files/${encode(filePath.replace(/^content\//, ''))}`;
}

export function HiddenTab() {
  const [groups, setGroups] = useState<HiddenGroup[]>([]);
  const [plantCounts, setPlantCounts] = useState<Map<string, number>>(new Map());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [thumbSize, setThumbSize] = useState<'lg' | 'md' | 'sm'>('md');

  // Check if an image is a known duplicate (same Original_Filepath as another record)
  const [dupeSet, setDupeSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/matches/hidden-images', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setGroups(data.groups);
        setTotal(data.total);
        setPlantCounts(new Map(data.groups.map((g: HiddenGroup) => [g.plant_id, g.count])));
        if (data.groups.length > 0) loadPlant(data.groups[0].plant_id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingGroups(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlant = useCallback((plantId: string) => {
    setSelectedPlant(plantId);
    setIsLoadingItems(true);
    setSelectedIds(new Set());
    setLastClickedIdx(null);

    fetch(`/api/matches/hidden-images?plant=${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setItems(data.items || []);
        // Build dupe set: any Original_Filepath that appears more than once
        const pathCounts = new Map<string, number>();
        for (const img of data.items || []) {
          if (img.Original_Filepath) {
            pathCounts.set(img.Original_Filepath, (pathCounts.get(img.Original_Filepath) || 0) + 1);
          }
        }
        setDupeSet(new Set([...pathCounts.entries()].filter(([_, c]) => c > 1).map(([p]) => p)));
      })
      .catch(() => {})
      .finally(() => setIsLoadingItems(false));
  }, []);

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
        if (next.has(item.Id)) next.delete(item.Id); else next.add(item.Id);
        return next;
      });
      setLastClickedIdx(idx);
    } else {
      // Plain click = preview
      setPreviewSrc(imgUrl(item.File_Path));
    }
  }, [lastClickedIdx, items]);

  const decrementPlant = useCallback((plantId: string, n: number) => {
    setPlantCounts(prev => {
      const next = new Map(prev);
      next.set(plantId, Math.max(0, (next.get(plantId) ?? n) - n));
      return next;
    });
    setTotal(prev => Math.max(0, prev - n));
  }, []);

  const handleRestore = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = [...selectedIds];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const res = await fetch('/api/browse/bulk-set-status', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, status: 'assigned' }),
        });
        if (!res.ok) { toast.error('Failed'); return; }
      }
      toast.success(`Restored ${ids.length} images`);
      if (selectedPlant) { decrementPlant(selectedPlant, ids.length); loadPlant(selectedPlant); }
      setSelectedIds(new Set());
    } catch { toast.error('Failed'); }
  }, [selectedIds, selectedPlant, loadPlant, decrementPlant]);

  const handleReassign = useCallback(async (plant: PlantSuggestion) => {
    if (selectedIds.size === 0) return;
    try {
      const ids = [...selectedIds];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        await fetch('/api/browse/bulk-reassign-images', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, plant_id: plant.Id1 }),
        });
      }
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        await fetch('/api/browse/bulk-set-status', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_ids: batch, status: 'assigned' }),
        });
      }
      toast.success(`Assigned ${ids.length} images to ${plant.Canonical_Name}`);
      if (selectedPlant) { decrementPlant(selectedPlant, ids.length); loadPlant(selectedPlant); }
      setSelectedIds(new Set());
    } catch { toast.error('Failed'); }
  }, [selectedIds, selectedPlant, loadPlant, decrementPlant]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold">Hidden Images</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{total} images hidden. Ctrl+click to select, click to preview.</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoadingGroups ? (
            <div className="p-3 space-y-1">{[1,2,3].map(n => <Skeleton key={n} className="h-7 w-full" />)}</div>
          ) : (
            groups.map(g => {
              const liveCount = plantCounts.get(g.plant_id) ?? g.count;
              const isDone = liveCount === 0;
              return (
                <button
                  key={g.plant_id}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${
                    selectedPlant === g.plant_id ? 'bg-accent font-medium' : isDone ? 'opacity-40 hover:bg-muted' : 'hover:bg-muted'
                  }`}
                  onClick={() => loadPlant(g.plant_id)}
                >
                  {g.plant_name}
                  <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {isDone ? '✓' : liveCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {!selectedPlant ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a plant to view hidden images.</p>
        ) : isLoadingItems ? (
          <div className="space-y-3">{[1,2,3].map(n => <Skeleton key={n} className="h-20 w-full rounded-lg" />)}</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No hidden images for this plant.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                {items.length} hidden images
                {selectedIds.size > 0 && <span className="ml-2 text-blue-600 font-medium">· {selectedIds.size} selected</span>}
              </p>
              <ThumbSizeToggle value={thumbSize} onChange={setThumbSize} />
            </div>
            <div className={GRID_CLASSES[thumbSize]}>
              {items.map((item, idx) => {
                const isSel = selectedIds.has(item.Id);
                const isDupe = item.Original_Filepath && dupeSet.has(item.Original_Filepath);
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
                        className={`w-full h-full object-cover opacity-60 ${isSel ? 'opacity-40' : ''}`}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      {isDupe && (
                        <div className="absolute top-1 left-1 z-10 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">DUPE</div>
                      )}
                      {isSel && (
                        <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate" title={item.File_Path}>
                      {(item.File_Path || '').split('/').pop()}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-12 left-[250px] right-0 z-50 bg-blue-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-3 bg-green-100 hover:bg-green-200 text-green-800" onClick={handleRestore}>
              Restore
            </Button>
            <div className="min-w-[180px]">
              <PlantAutocomplete
                label=""
                placeholder="Assign to plant..."
                inputClassName="h-6 text-xs bg-white text-black"
                dropdownLeftClass="left-0"
                onSelect={handleReassign}
                onCreateAndSelect={async (name, slug) => handleReassign({ Id: 0, Id1: slug, Canonical_Name: name })}
                createMessage={(name) => `Create "${name}" and assign ${selectedIds.size} images?`}
                createLabel="Create & Assign"
              />
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
              onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
