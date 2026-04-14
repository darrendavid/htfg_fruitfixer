import { useState, useEffect, useCallback } from 'react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { ClassifyActionBar } from './ClassifyActionBar';
import { toast } from 'sonner';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';
import { PlantGroupSidebar } from './PlantGroupSidebar';
import type { LostImageItem, LostImageGroup, LostImageGroupsResponse, LostImageItemsResponse } from '@/types/matches';

type ViewMode = 'list' | 'card';

function Thumb({ item, imgUrl, onPreview }: {
  item: LostImageItem;
  imgUrl: (i: LostImageItem) => string;
  onPreview: () => void;
}) {
  return (
    <>
      {item.new_file_path ? (
        <img
          src={imgUrl(item)}
          alt={item.original_filepath?.split('/').pop() ?? ''}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = 'none';
            const sib = el.nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = 'flex';
          }}
        />
      ) : null}
      <div className="items-center justify-center h-full text-xs text-muted-foreground"
        style={{ display: item.new_file_path ? 'none' : 'flex' }}>
        Missing
      </div>
      <button
        className="absolute bottom-0.5 right-0.5 z-10 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 hover:opacity-100 transition-opacity"
        onClick={(e) => { e.stopPropagation(); onPreview(); }}
        title="Preview"
      >🔍</button>
    </>
  );
}

export function LostImageTab() {
  const [groups, setGroups] = useState<LostImageGroup[]>([]);
  const [plantCounts, setPlantCounts] = useState<Map<string, number>>(new Map());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<LostImageItem[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [totalRecovered, setTotalRecovered] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const { selectedIds, handleClick: multiSelectClick, clearSelection } =
    useMultiSelect<LostImageItem, number>(items, item => item.image_id);

  useEffect(() => {
    fetch('/api/matches/lost-images', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: LostImageGroupsResponse) => {
        setGroups(data.groups);
        setTotalRecovered(data.total);
        setPlantCounts(new Map(data.groups.map((g: LostImageGroup) => [g.plant_id, g.count])));
        if (data.groups.length > 0) loadPlant(data.groups[0].plant_id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingGroups(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlant = useCallback((plantId: string) => {
    setSelectedPlant(plantId);
    setIsLoadingItems(true);
    setItems([]);
    clearSelection();

    fetch(`/api/matches/lost-images?plant=${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: LostImageItemsResponse) => setItems(
        [...data.items].sort((a, b) => (a.original_filepath ?? '').localeCompare(b.original_filepath ?? ''))
      ))
      .catch(() => {})
      .finally(() => setIsLoadingItems(false));
  }, [clearSelection]);

  function imgUrl(item: LostImageItem): string {
    if (!item.new_file_path) return '';
    return imgUrlFromFilePath(item.new_file_path);
  }

  const handleImageClick = useCallback((e: React.MouseEvent, item: LostImageItem, idx: number) => {
    const result = multiSelectClick(e, item, idx);
    if (result === 'plain') {
      setPreviewSrc(imgUrl(item));
    }
  }, [multiSelectClick]);

  const dismissSelected = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    await fetch('/api/matches/dismiss-lost-images', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: ids }),
    }).catch(() => {/* best-effort */});
  }, []);

  const removeSelected = useCallback(async () => {
    const ids = [...selectedIds] as number[];
    setItems(prev => prev.filter(i => !selectedIds.has(i.image_id)));
    setTotalRecovered(prev => prev - ids.length);
    if (selectedPlant) {
      setPlantCounts(prev => {
        const next = new Map(prev);
        next.set(selectedPlant, Math.max(0, (next.get(selectedPlant) ?? 0) - ids.length));
        return next;
      });
    }
    clearSelection();
    await dismissSelected(ids);
  }, [selectedIds, clearSelection, dismissSelected]);

  const handleAssign = useCallback(async (plant: PlantSuggestion) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-reassign-images', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], plant_id: plant.Id1 }),
      });
      if (res.ok) {
        toast.success(`Assigned ${selectedIds.size} images to ${plant.Canonical_Name}`);
        await removeSelected();
      } else { toast.error('Assignment failed'); }
    } catch { toast.error('Assignment failed'); }
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
        await removeSelected();
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
        await removeSelected();
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, removeSelected]);

  return (
    <div className="flex h-full overflow-hidden">
      <PlantGroupSidebar
        title="Recovered Images"
        subtitle={`${totalRecovered} images recovered from source`}
        groups={groups.map(g => ({ id: g.plant_id, label: g.plant_name, count: g.count }))}
        selectedId={selectedPlant}
        liveCounts={plantCounts}
        isLoading={isLoadingGroups}
        onSelect={loadPlant}
      />

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {!selectedPlant ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a plant to view recovered images.</p>
        ) : isLoadingItems ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <Skeleton key={n} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No recovered images for this plant.</p>
        ) : (
          <>
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{groups.find(g => g.plant_id === selectedPlant)?.plant_name}</span> · {items.length} recovered
                {selectedIds.size > 0 && <span className="ml-2 text-blue-600 font-medium">· {selectedIds.size} selected (Esc to clear)</span>}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant={viewMode === 'list' ? 'default' : 'outline'} className="h-6 px-2 text-xs" onClick={() => setViewMode('list')}>List</Button>
                <Button size="sm" variant={viewMode === 'card' ? 'default' : 'outline'} className="h-6 px-2 text-xs" onClick={() => setViewMode('card')}>Cards</Button>
              </div>
            </div>

            {viewMode === 'list' ? (
              <div className="space-y-1.5">
                {items.map((item, idx) => {
                  const isSel = selectedIds.has(item.image_id);
                  return (
                    <div
                      key={item.image_id}
                      className={`flex gap-3 items-center p-2 rounded-lg border cursor-pointer transition-colors ${
                        isSel ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400 ring-offset-1' : 'border-border hover:bg-muted/30'
                      }`}
                      onClick={(e) => handleImageClick(e, item, idx)}
                    >
                      {/* Thumbnail */}
                      <div className="shrink-0 w-[72px] h-[54px] bg-muted rounded overflow-hidden relative">
                        <Thumb item={item} imgUrl={imgUrl} onPreview={() => setPreviewSrc(imgUrl(item))} />
                        {isSel && <div className="absolute top-0.5 right-0.5 z-10 bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">✓</div>}
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5 overflow-hidden">
                        <p className="text-xs font-medium truncate">
                          {item.new_file_path?.split('/').pop() ?? item.old_file_path.split('/').pop()}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate select-all cursor-text"
                          title={item.source_directory}
                          onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey) e.stopPropagation(); }}>
                          <span className="font-semibold text-muted-foreground/70">Source:</span> {item.source_directory || '(unknown)'}
                        </p>
                        {item.original_filepath && (
                          <p className="text-[10px] text-muted-foreground truncate select-all cursor-text"
                            title={item.original_filepath}
                            onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey) e.stopPropagation(); }}>
                            <span className="font-semibold text-muted-foreground/70">Original:</span> {item.original_filepath.replace(/^content\/source\//, '')}
                          </p>
                        )}
                        <div className="flex gap-1">
                          <Badge variant="outline" className="text-[9px] h-4 px-1">{item.status}</Badge>
                          {!item.plant_id && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700">no plant</Badge>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {items.map((item, idx) => {
                  const isSel = selectedIds.has(item.image_id);
                  return (
                    <div
                      key={item.image_id}
                      className={`flex flex-col gap-1 cursor-pointer rounded overflow-hidden ${
                        isSel ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'
                      }`}
                      onClick={(e) => handleImageClick(e, item, idx)}
                    >
                      <div className="aspect-square bg-muted rounded overflow-hidden relative">
                        <Thumb item={item} imgUrl={imgUrl} onPreview={() => setPreviewSrc(imgUrl(item))} />
                        {isSel && <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate px-0.5" title={item.new_file_path?.split('/').pop()}>
                        {item.new_file_path?.split('/').pop() ?? item.old_file_path.split('/').pop()}
                      </p>
                      {item.source_directory && (
                        <p className="text-[9px] text-muted-foreground/60 truncate px-0.5" title={item.source_directory}>
                          {item.source_directory.split('/').slice(-2).join('/')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      <ClassifyActionBar
        selectedCount={selectedIds.size}
        sidebarWidth={250}
        plantPicker={{
          placeholder: 'Assign to plant...',
          onSelect: handleAssign,
          onCreateAndSelect: async (name, slug) => handleAssign({ Id: 0, Id1: slug, Canonical_Name: name }),
          createMessage: (name) => `Create "${name}" and assign ${selectedIds.size} images?`,
          createLabel: 'Create & Assign',
        }}
        buttons={[
          { label: 'Triage', onClick: handleTriage },
          { label: 'Hide', onClick: handleHide, className: 'bg-red-100 hover:bg-red-200 text-red-800' },
        ]}
        onClear={clearSelection}
      />

      <ImagePreviewDialog
        src={previewSrc}
        alt="Recovered image"
        open={!!previewSrc}
        onOpenChange={(open) => { if (!open) setPreviewSrc(null); }}
      />
    </div>
  );
}
