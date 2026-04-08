import { useState, useEffect, useCallback } from 'react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ClassifyActionBar } from './ClassifyActionBar';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';
import { PlantGroupSidebar } from './PlantGroupSidebar';

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

  const { selectedIds, setSelectedIds, handleClick: multiSelectClick, clearSelection } =
    useMultiSelect<any, number>(items, item => item.Id);

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
    clearSelection();
    fetch(`/api/matches/unmatched-images?plant=${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setItems(data.items))
      .catch(() => {})
      .finally(() => setIsLoadingItems(false));
  }, []);

  const handleImageClick = useCallback((e: React.MouseEvent, item: any, idx: number) => {
    const result = multiSelectClick(e, item, idx);
    if (result === 'plain') {
      setPreviewSrc(imgUrlFromFilePath(item.File_Path));
    }
  }, [multiSelectClick]);

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
    clearSelection();
  }, [selectedIds, selectedPlant, clearSelection]);

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
      <PlantGroupSidebar
        title="No Variety Assigned"
        subtitle={`${total} images with plant but no variety`}
        groups={groups.map(g => ({ id: g.plant_id, label: g.plant_id, count: g.count }))}
        selectedId={selectedPlant}
        liveCounts={plantCounts}
        isLoading={isLoadingGroups}
        onSelect={loadPlant}
      />

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
                      <img src={imgUrlFromFilePath(item.File_Path)} alt={item.Caption ?? ''} loading="lazy"
                        className={`w-full h-full object-cover ${isSel ? 'opacity-75' : ''}`} />
                      {isSel && (
                        <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
                      )}
                      <button
                        className="absolute bottom-0.5 right-0.5 z-10 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); setPreviewSrc(imgUrlFromFilePath(item.File_Path)); }}
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

      <ClassifyActionBar
        selectedCount={selectedIds.size}
        sidebarWidth={250}
        plantPicker={{
          placeholder: 'Move to plant...',
          onSelect: handleReassign,
          onCreateAndSelect: async (name, slug) => handleReassign({ Id: 0, Id1: slug, Canonical_Name: name }),
          createMessage: (name) => `Create "${name}" and move ${selectedIds.size} images?`,
          createLabel: 'Create & Move',
          excludePlantId: selectedPlant ?? undefined,
        }}
        buttons={[
          { label: 'Triage', onClick: handleTriage },
          { label: 'Hide', onClick: handleHide, className: 'bg-red-100 hover:bg-red-200 text-red-800' },
        ]}
        onClear={clearSelection}
      >
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
      </ClassifyActionBar>

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
