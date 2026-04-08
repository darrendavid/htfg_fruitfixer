import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';

interface UnmatchedGroup { plant_id: string; count: number; }

export function UnmatchedTab() {
  const [groups, setGroups] = useState<UnmatchedGroup[]>([]);
  const [plantCounts, setPlantCounts] = useState<Map<string, number>>(new Map());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/matches/unmatched-images', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setGroups(data.groups);
        setPlantCounts(new Map(data.groups.map((g: UnmatchedGroup) => [g.plant_id, g.count])));
        setTotal(data.total);
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
    fetch(`/api/matches/unmatched-images?plant=${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setItems(data.items))
      .catch(() => {})
      .finally(() => setIsLoadingItems(false));
  }, []);

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
        if (next.has(item.Id)) next.delete(item.Id); else next.add(item.Id);
        return next;
      });
      setLastClickedIdx(idx);
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.Id)) next.delete(item.Id); else next.add(item.Id);
        return next;
      });
      setLastClickedIdx(idx);
    }
  }, [lastClickedIdx, items]);

  const removeSelected = useCallback((count?: number) => {
    const n = count ?? selectedIds.size;
    setItems(prev => prev.filter(i => !selectedIds.has(i.Id)));
    setTotal(prev => Math.max(0, prev - n));
    if (selectedPlant) {
      setPlantCounts(prev => {
        const next = new Map(prev);
        next.set(selectedPlant, Math.max(0, (next.get(selectedPlant) ?? n) - n));
        return next;
      });
    }
    setSelectedIds(new Set());
  }, [selectedIds, selectedPlant]);

  const handleSetVariety = useCallback(async (variety: VarietySelection | null) => {
    if (selectedIds.size === 0 || !selectedPlant) return;
    try {
      const res = await fetch('/api/browse/bulk-set-variety', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], variety_id: variety?.id ?? null }),
      });
      if (res.ok) {
        toast.success(`Set variety on ${selectedIds.size} images`);
        removeSelected();
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, selectedPlant, removeSelected]);

  const handleReassign = useCallback(async (plant: PlantSuggestion) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-reassign-images', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], plant_id: plant.Id1 }),
      });
      if (res.ok) {
        toast.success(`Moved ${selectedIds.size} images to ${plant.Canonical_Name}`);
        removeSelected();
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, removeSelected]);

  const handleHide = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-set-status', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], status: 'hidden' }),
      });
      if (res.ok) {
        toast.success(`Hidden ${selectedIds.size} images`);
        removeSelected();
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, removeSelected]);

  const handleTriage = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-set-status', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], status: 'triage' }),
      });
      if (res.ok) {
        toast.success(`Sent ${selectedIds.size} images to Triage`);
        removeSelected();
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, removeSelected]);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold">No Variety Assigned</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{total} images with plant but no variety</p>
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
                  {g.plant_id}
                  <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {isDone ? '✓' : liveCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {!selectedPlant ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a plant to view images without variety.</p>
        ) : isLoadingItems ? (
          <div className="space-y-3">{[1,2,3].map(n => <Skeleton key={n} className="h-20 w-full rounded-lg" />)}</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No unmatched images.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {items.length} images
              {selectedIds.size > 0 && <span className="ml-2 text-blue-600 font-medium">· {selectedIds.size} selected (Esc to clear)</span>}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {items.map((item, idx) => {
                const isSel = selectedIds.has(item.Id);
                return (
                  <div key={item.Id} className="space-y-1">
                    <div
                      className={`aspect-square bg-muted rounded overflow-hidden cursor-pointer relative ${isSel ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'}`}
                      onClick={(e) => handleImageClick(e, item, idx)}
                    >
                      <img src={imgUrl(item.File_Path)} alt={item.Caption ?? ''} loading="lazy"
                        className={`w-full h-full object-cover ${isSel ? 'opacity-75' : ''}`} />
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
          </>
        )}
      </main>

      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-12 left-[250px] right-0 z-50 bg-blue-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>

            {/* Variety assignment */}
            {selectedPlant && (
              <div className="min-w-[180px] [&_input]:bg-white [&_input]:text-black [&_label]:text-white">
                <VarietyPicker
                  plantId={selectedPlant}
                  currentVariety={null}
                  onSelect={handleSetVariety}
                />
              </div>
            )}

            {/* Plant reassignment */}
            <div className="min-w-[180px]">
              <PlantAutocomplete
                label=""
                placeholder="Move to plant..."
                inputClassName="h-6 text-xs bg-white text-black"
                dropdownLeftClass="left-0"
                excludePlantId={selectedPlant ?? undefined}
                onSelect={handleReassign}
                onCreateAndSelect={async (name, slug) => handleReassign({ Id: 0, Id1: slug, Canonical_Name: name })}
                createMessage={(name) => `Create "${name}" and move ${selectedIds.size} images?`}
                createLabel="Create & Move"
              />
            </div>

            <Button size="sm" variant="secondary" className="h-6 text-xs px-2" onClick={handleTriage}>Triage</Button>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-2 bg-red-100 hover:bg-red-200 text-red-800" onClick={handleHide}>Hide</Button>

            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
              onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
