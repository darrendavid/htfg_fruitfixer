import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { ThumbSizeToggle } from '@/components/ui/thumb-size-toggle';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { toast } from 'sonner';
import { imgUrlFromFilePath, CLASSIFY_GRID_CLASSES } from '@/lib/gallery-utils';
import { ClassifyActionBar } from './ClassifyActionBar';

const IMG_EXTS = /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i;
const DOC_EXT_COLORS: Record<string, string> = {
  pdf: 'bg-red-500', doc: 'bg-blue-500', docx: 'bg-blue-500',
  ppt: 'bg-orange-500', pptx: 'bg-orange-500',
  xls: 'bg-green-500', xlsx: 'bg-green-500', txt: 'bg-gray-400',
};

interface TriageItem {
  source: 'database' | 'filesystem';
  image_id?: number;
  file_path: string;
  filename: string;
  original_filepath?: string;
  caption?: string;
  file_size: number;
  file_type: 'image' | 'document';
}

function isImageFile(item: TriageItem): boolean {
  return IMG_EXTS.test(item.filename);
}

function fileExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function openUrl(item: TriageItem): string {
  const fp = item.file_path;
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  return `/content-files/${encode(fp.replace(/^content\//, ''))}`;
}

export function TriageTab() {
  const [dbItems, setDbItems] = useState<TriageItem[]>([]);
  const [fsItems, setFsItems] = useState<TriageItem[]>([]);
  const [totalDb, setTotalDb] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [thumbSize, setThumbSize] = useState<'lg' | 'md' | 'sm'>('md');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const LIMIT = 100;

  const allItems = useMemo(() => [...fsItems, ...dbItems], [fsItems, dbItems]);
  const totalAll = totalDb + fsItems.length;

  const { selectedIds, setSelectedIds, handleClick: multiSelectClick, clearSelection } =
    useMultiSelect<TriageItem, string>(allItems, item => item.file_path);

  const fetchPage = useCallback((off: number) => {
    setIsLoading(true);
    fetch(`/api/matches/triage?offset=${off}&limit=${LIMIT}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setDbItems(data.db_items || []);
        if (off === 0) setFsItems(data.fs_items || []);
        setTotalDb(data.total_db);
        setOffset(off);
        clearSelection();
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [clearSelection]);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const handleImageClick = useCallback((e: React.MouseEvent, item: TriageItem, idx: number) => {
    const result = multiSelectClick(e, item, idx);
    if (result === 'plain') {
      // Plain click = preview image or open document
      if (isImageFile(item)) {
        setPreviewSrc(imgUrlFromFilePath(item.file_path));
      } else {
        window.open(openUrl(item), '_blank');
      }
    }
  }, [multiSelectClick]);

  const getSelectedItems = useCallback(() => {
    const lookup = new Map(allItems.map(i => [i.file_path, i]));
    const dbIds: number[] = [];
    const fsPaths: string[] = [];
    for (const fp of selectedIds) {
      const item = lookup.get(fp);
      if (!item) continue;
      if (item.source === 'database' && item.image_id) dbIds.push(item.image_id);
      else if (item.source === 'filesystem') fsPaths.push(item.file_path);
    }
    return { dbIds, fsPaths };
  }, [allItems, selectedIds]);

  const handleAssign = useCallback(async (plant: PlantSuggestion) => {
    const { dbIds, fsPaths } = getSelectedItems();
    if (dbIds.length === 0 && fsPaths.length === 0) return;
    try {
      // DB items: bulk-reassign + set status=assigned
      if (dbIds.length > 0) {
        for (let i = 0; i < dbIds.length; i += 50) {
          const batch = dbIds.slice(i, i + 50);
          const res = await fetch('/api/browse/bulk-reassign-images', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_ids: batch, plant_id: plant.Id1 }),
          });
          if (!res.ok) { toast.error('Failed to reassign DB images'); return; }
        }
        for (let i = 0; i < dbIds.length; i += 50) {
          const batch = dbIds.slice(i, i + 50);
          await fetch('/api/browse/bulk-set-status', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_ids: batch, status: 'assigned' }),
          });
        }
      }
      // Filesystem items: move file + create NocoDB record
      if (fsPaths.length > 0) {
        for (let i = 0; i < fsPaths.length; i += 20) {
          const batch = fsPaths.slice(i, i + 20);
          const res = await fetch('/api/matches/assign-triage-fs', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_paths: batch, plant_id: plant.Id1 }),
          });
          if (!res.ok) { toast.error('Failed to assign filesystem images'); return; }
        }
      }
      toast.success(`Assigned ${dbIds.length + fsPaths.length} images to ${plant.Canonical_Name}`);
      clearSelection();
      fetchPage(offset);
    } catch { toast.error('Failed'); }
  }, [selectedIds, getSelectedItems, offset, fetchPage, clearSelection]);

  const handleHide = useCallback(async () => {
    const { dbIds, fsPaths } = getSelectedItems();
    if (dbIds.length === 0 && fsPaths.length === 0) return;
    try {
      if (dbIds.length > 0) {
        for (let i = 0; i < dbIds.length; i += 50) {
          const batch = dbIds.slice(i, i + 50);
          const res = await fetch('/api/browse/bulk-set-status', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_ids: batch, status: 'hidden' }),
          });
          if (!res.ok) { toast.error('Failed'); return; }
        }
      }
      if (fsPaths.length > 0) {
        for (let i = 0; i < fsPaths.length; i += 20) {
          const batch = fsPaths.slice(i, i + 20);
          const res = await fetch('/api/matches/hide-triage-fs', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_paths: batch }),
          });
          if (!res.ok) { toast.error('Failed to hide filesystem images'); return; }
        }
      }
      toast.success(`Hidden ${dbIds.length + fsPaths.length} images`);
      clearSelection();
      fetchPage(offset);
    } catch { toast.error('Failed'); }
  }, [selectedIds, getSelectedItems, offset, fetchPage, clearSelection]);


  const totalPages = Math.ceil(totalDb / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 p-3 border-b bg-background flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Triage</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalAll} items flagged for review. Ctrl+click to select, click to preview.
          </p>
        </div>
        <ThumbSizeToggle value={thumbSize} onChange={setThumbSize} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(n => <Skeleton key={n} className="h-20 w-full rounded-lg" />)}</div>
        ) : allItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No items in triage.</p>
        ) : (
          <>
            {selectedIds.size > 0 && (
              <p className="text-xs text-blue-600 font-medium mb-2">{selectedIds.size} selected (Esc to clear)</p>
            )}
            <div className={CLASSIFY_GRID_CLASSES[thumbSize]}>
              {allItems.map((item, idx) => {
                const isSel = selectedIds.has(item.file_path);
                const isImg = isImageFile(item);
                const ext = fileExt(item.filename);
                return (
                  <div key={item.file_path} className="space-y-1" data-testid={`triage-item-${idx}`}>
                    <div
                      className={`aspect-square bg-muted rounded overflow-hidden cursor-pointer relative ${isSel ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'}`}
                      onClick={(e) => handleImageClick(e, item, idx)}
                    >
                      {isImg ? (
                        <img
                          src={imgUrlFromFilePath(item.file_path)}
                          alt={item.caption ?? ''}
                          loading="lazy"
                          className={`w-full h-full object-cover ${isSel ? 'opacity-75' : ''}`}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase text-white ${DOC_EXT_COLORS[ext] ?? 'bg-gray-500'}`}>
                            {ext || 'file'}
                          </span>
                          <span className="text-[10px] text-muted-foreground text-center px-1 leading-tight truncate max-w-full">
                            {item.filename}
                          </span>
                        </div>
                      )}
                      {isSel && (
                        <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
                      )}
                      {item.source === 'filesystem' && (
                        <div className="absolute top-1 left-1 z-10 bg-amber-500/80 text-white text-[8px] px-1 rounded">FS</div>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate" title={item.file_path}>
                      {item.filename}
                    </p>
                    {item.original_filepath && (
                      <p className="text-[9px] text-muted-foreground/60 truncate" title={item.original_filepath}>
                        {item.original_filepath.replace(/^content\/source\//, '').split('/').slice(-2).join('/')}
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
                <Button variant="outline" size="sm" disabled={offset + LIMIT >= totalDb} onClick={() => fetchPage(offset + LIMIT)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>

      <ClassifyActionBar
        selectedCount={selectedIds.size}
        sidebarWidth={0}
        plantPicker={{
          placeholder: 'Assign to plant...',
          onSelect: handleAssign,
          onCreateAndSelect: async (name, slug) => handleAssign({ Id: 0, Id1: slug, Canonical_Name: name }),
          createMessage: (name) => `Create "${name}" and assign ${selectedIds.size} images?`,
          createLabel: 'Create & Assign',
        }}
        buttons={[
          { label: 'Hide', onClick: handleHide, className: 'bg-red-100 hover:bg-red-200 text-red-800' },
        ]}
        onClear={clearSelection}
      />

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </div>
  );
}
