import { useState, useEffect, useCallback } from 'react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';
import { PlantGroupSidebar } from './PlantGroupSidebar';
import type { LostImageItem, LostImageGroup, LostImageGroupsResponse, LostImageItemsResponse } from '@/types/matches';

export function LostImageTab() {
  const [groups, setGroups] = useState<LostImageGroup[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<LostImageItem[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [totalRecovered, setTotalRecovered] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const { selectedIds, setSelectedIds, handleClick: multiSelectClick, clearSelection } =
    useMultiSelect<LostImageItem, number>(items, item => item.image_id);

  useEffect(() => {
    fetch('/api/matches/lost-images', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: LostImageGroupsResponse) => {
        setGroups(data.groups);
        setTotalRecovered(data.total);
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
      .then((data: LostImageItemsResponse) => setItems(data.items))
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

  const removeSelected = useCallback(() => {
    setItems(prev => prev.filter(i => !selectedIds.has(i.image_id)));
    setTotalRecovered(prev => prev - selectedIds.size);
    clearSelection();
  }, [selectedIds, clearSelection]);

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
        removeSelected();
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
        title="Recovered Images"
        subtitle={`${totalRecovered} images recovered from source`}
        groups={groups.map(g => ({ id: g.plant_id, label: g.plant_name, count: g.count }))}
        selectedId={selectedPlant}
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
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">
              <span className="font-medium">{groups.find(g => g.plant_id === selectedPlant)?.plant_name}</span> · {items.length} recovered images
              {selectedIds.size > 0 && <span className="ml-2 text-blue-600 font-medium">· {selectedIds.size} selected (Esc to clear)</span>}
            </p>
            {items.map((item, idx) => {
              const isSel = selectedIds.has(item.image_id);
              return (
                <div
                  key={item.image_id}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    isSel ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400 ring-offset-1' : 'border-border hover:bg-muted/30'
                  }`}
                  onClick={(e) => handleImageClick(e, item, idx)}
                >
                  {isSel && (
                    <div className="absolute top-2 left-2 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold pointer-events-none">✓</div>
                  )}
                  {/* Thumbnail */}
                  <div className="shrink-0 w-[120px] h-[90px] bg-muted rounded overflow-hidden relative">
                    {item.new_file_path ? (
                      <img
                        src={imgUrl(item)}
                        alt={item.original_filepath?.split('/').pop() ?? ''}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Missing</div>
                    )}
                    <button
                      className="absolute bottom-0.5 right-0.5 z-10 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setPreviewSrc(imgUrl(item)); }}
                      title="Preview"
                    >🔍</button>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <p className="text-sm font-medium truncate">
                      {item.new_file_path?.split('/').pop() ?? item.old_file_path.split('/').pop()}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate select-all cursor-text" title={item.source_directory} onClick={(e) => e.stopPropagation()}>
                      <span className="font-semibold text-muted-foreground/70">Source:</span> {item.source_directory || '(unknown)'}
                    </p>
                    {item.original_filepath && (
                      <p className="text-[10px] text-muted-foreground truncate select-all cursor-text" title={item.original_filepath} onClick={(e) => e.stopPropagation()}>
                        <span className="font-semibold text-muted-foreground/70">Original:</span> {item.original_filepath.replace(/^content\/source\//, '')}
                      </p>
                    )}
                    <div className="flex gap-1 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                      {!item.plant_id && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700">no plant</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-12 left-[250px] right-0 z-50 bg-blue-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>
            <div className="min-w-[180px]">
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
            <Button size="sm" variant="secondary" className="h-6 text-xs px-2" onClick={handleTriage}>Triage</Button>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-2 bg-red-100 hover:bg-red-200 text-red-800" onClick={handleHide}>Hide</Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
              onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      <ImagePreviewDialog
        src={previewSrc}
        alt="Recovered image"
        open={!!previewSrc}
        onOpenChange={(open) => { if (!open) setPreviewSrc(null); }}
      />
    </div>
  );
}
