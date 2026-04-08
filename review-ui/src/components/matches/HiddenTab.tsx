import { useState, useEffect, useCallback } from 'react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ThumbSizeToggle } from '@/components/ui/thumb-size-toggle';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';
import { imgUrlFromFilePath, CLASSIFY_GRID_CLASSES } from '@/lib/gallery-utils';
import { PlantGroupSidebar } from './PlantGroupSidebar';
import { ClassifyActionBar } from './ClassifyActionBar';

interface HiddenGroup { plant_id: string; plant_name: string; count: number; }

export function HiddenTab() {
  const [groups, setGroups] = useState<HiddenGroup[]>([]);
  const [plantCounts, setPlantCounts] = useState<Map<string, number>>(new Map());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState<'lg' | 'md' | 'sm'>('md');

  const { selectedIds, setSelectedIds, handleClick: multiSelectClick, clearSelection } =
    useMultiSelect<any, number>(items, item => item.Id);

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
    clearSelection();

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
  }, [clearSelection]);

  const handleImageClick = useCallback((e: React.MouseEvent, item: any, idx: number) => {
    const result = multiSelectClick(e, item, idx);
    if (result === 'plain') {
      setPreviewSrc(imgUrlFromFilePath(item.File_Path));
    }
  }, [multiSelectClick]);

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
      clearSelection();
    } catch { toast.error('Failed'); }
  }, [selectedIds, selectedPlant, loadPlant, decrementPlant, clearSelection]);

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
      clearSelection();
    } catch { toast.error('Failed'); }
  }, [selectedIds, selectedPlant, loadPlant, decrementPlant, clearSelection]);

  return (
    <div className="flex h-full overflow-hidden">
      <PlantGroupSidebar
        title="Hidden Images"
        subtitle={`${total} images hidden. Ctrl+click to select, click to preview.`}
        groups={groups.map(g => ({ id: g.plant_id, label: g.plant_name, count: g.count }))}
        selectedId={selectedPlant}
        liveCounts={plantCounts}
        isLoading={isLoadingGroups}
        onSelect={loadPlant}
      />

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
            <div className={CLASSIFY_GRID_CLASSES[thumbSize]}>
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
                        src={imgUrlFromFilePath(item.File_Path)}
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

      <ClassifyActionBar
        selectedCount={selectedIds.size}
        sidebarWidth={250}
        buttons={[
          { label: 'Restore', onClick: handleRestore, className: 'bg-green-100 hover:bg-green-200 text-green-800' },
        ]}
        plantPicker={{
          placeholder: 'Assign to plant...',
          onSelect: handleReassign,
          onCreateAndSelect: async (name, slug) => handleReassign({ Id: 0, Id1: slug, Canonical_Name: name }),
          createMessage: (name) => `Create "${name}" and assign ${selectedIds.size} images?`,
          createLabel: 'Create & Assign',
        }}
        onClear={clearSelection}
      />

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
