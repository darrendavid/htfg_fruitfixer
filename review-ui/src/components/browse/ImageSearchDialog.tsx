import { useState, useCallback, useRef, memo } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, RotateCw, Trash2, Search } from 'lucide-react';
import { PlantAutocomplete, type PlantSuggestion } from './PlantAutocomplete';
import { ImagePreviewDialog } from '@/components/matches/ImagePreviewDialog';
import { buildImageUrl, rotationClass } from '@/lib/gallery-utils';
import { toast } from 'sonner';

interface SearchResult {
  assigned: Array<{ plant_id: string; images: any[] }>;
  unassigned: any[];
  total: number;
}

interface ImageSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlantId?: string;
}

function imgUrl(img: any): string {
  const fp = img.File_Path || '';
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  if (fp.startsWith('content/pass_01/assigned/'))
    return `/images/${encode(fp.replace('content/pass_01/assigned/', ''))}`;
  if (fp.startsWith('content/pass_01/unassigned/'))
    return `/unassigned-images/${encode(fp.replace('content/pass_01/unassigned/', ''))}`;
  return `/content-files/${encode(fp.replace(/^content\//, ''))}`;
}

const SearchImageCard = memo(function SearchImageCard({
  img, isSelected, onClick,
}: {
  img: any; isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="space-y-1">
      <div
        className={`group aspect-square bg-muted rounded overflow-hidden cursor-pointer relative transition-shadow ${
          isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'
        }`}
        onClick={onClick}
      >
        <div className={`w-full h-full ${rotationClass(img.Rotation)}`}>
          <img
            src={imgUrl(img)}
            alt={img.Caption ?? ''}
            loading="lazy"
            className={`w-full h-full object-cover ${isSelected ? 'opacity-75' : ''}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        {isSelected && (
          <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
        )}
        {img.Size_Bytes > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/70 text-white text-[9px] px-1 py-0.5 text-center font-mono">
            {(img.Size_Bytes / 1024).toFixed(0)}KB
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground truncate" title={img.File_Path}>
        {(img.File_Path || '').split('/').pop()}
      </p>
      {img.Original_Filepath && (
        <p className="text-[9px] text-muted-foreground/60 truncate" title={img.Original_Filepath}>
          {img.Original_Filepath.replace(/^content\/source\//, '').split('/').slice(-2).join('/')}
        </p>
      )}
    </div>
  );
});

export function ImageSearchDialog({ open, onOpenChange, currentPlantId }: ImageSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'assigned' | 'unassigned'>('assigned');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/matches/search-images?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setSelectedIds(new Set());
        setLastClickedIdx(null);
      }
    } catch {}
    finally { setIsSearching(false); }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val.trim()), 400);
  };

  // Get flat list for current tab
  const currentImages = activeTab === 'assigned'
    ? (results?.assigned ?? []).flatMap(g => g.images)
    : (results?.unassigned ?? []);

  const handleImageClick = useCallback((e: React.MouseEvent, img: any, idx: number) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      e.preventDefault();
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) if (currentImages[i]) next.add(currentImages[i].Id);
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(img.Id)) next.delete(img.Id); else next.add(img.Id);
        return next;
      });
      setLastClickedIdx(idx);
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(img.Id)) next.delete(img.Id); else next.add(img.Id);
        return next;
      });
      setLastClickedIdx(idx);
    }
  }, [lastClickedIdx, currentImages]);

  const handleReassign = useCallback(async (plant: PlantSuggestion) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-reassign-images', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [...selectedIds], plant_id: plant.Id1 }),
      });
      if (res.ok) {
        toast.success(`Reassigned ${selectedIds.size} images to ${plant.Canonical_Name}`);
        setSelectedIds(new Set());
        // Re-search to refresh results
        doSearch(query.trim());
      } else { toast.error('Reassignment failed'); }
    } catch { toast.error('Reassignment failed'); }
  }, [selectedIds, query, doSearch]);

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
        setSelectedIds(new Set());
        doSearch(query.trim());
      } else { toast.error('Failed'); }
    } catch { toast.error('Failed'); }
  }, [selectedIds, query, doSearch]);

  const assignedCount = results?.assigned?.reduce((s, g) => s + g.images.length, 0) ?? 0;
  const unassignedCount = results?.unassigned?.length ?? 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 [&>button[data-slot=dialog-close]]:z-20">
          <DialogTitle className="sr-only">Search Images</DialogTitle>

          {/* Search bar */}
          <div className="shrink-0 p-4 border-b">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <Input
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search by fruit name, filename, or original filepath..."
                className="flex-1"
                autoFocus
              />
              {isSearching && <span className="text-xs text-muted-foreground animate-pulse">Searching...</span>}
            </div>
          </div>

          {/* Result tabs */}
          {results && (
            <div className="shrink-0 border-b flex px-4">
              <button
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'assigned' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => { setActiveTab('assigned'); setSelectedIds(new Set()); setLastClickedIdx(null); }}
              >
                Assigned ({assignedCount})
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'unassigned' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => { setActiveTab('unassigned'); setSelectedIds(new Set()); setLastClickedIdx(null); }}
              >
                Unassigned ({unassignedCount})
              </button>
              {selectedIds.size > 0 && (
                <span className="ml-auto text-xs text-blue-600 font-medium self-center">{selectedIds.size} selected</span>
              )}
            </div>
          )}

          {/* Results */}
          <div className="flex-1 overflow-y-auto p-4">
            {!results && !isSearching && (
              <p className="text-sm text-muted-foreground text-center mt-12">Type at least 2 characters to search.</p>
            )}

            {results && activeTab === 'assigned' && (
              results.assigned.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center mt-8">No assigned images found.</p>
              ) : (
                <div className="space-y-6">
                  {results.assigned.map(group => {
                    const globalOffset = results.assigned.slice(0, results.assigned.indexOf(group)).reduce((s, g) => s + g.images.length, 0);
                    return (
                      <div key={group.plant_id}>
                        <div className="flex items-center gap-2 mb-2 border-b pb-1">
                          <p className="text-sm font-medium">{group.plant_id}</p>
                          <Badge variant="outline" className="text-xs">{group.images.length}</Badge>
                        </div>
                        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                          {group.images.map((img, localIdx) => {
                            const flatIdx = globalOffset + localIdx;
                            return (
                              <SearchImageCard
                                key={img.Id}
                                img={img}
                                isSelected={selectedIds.has(img.Id)}
                                onClick={(e) => handleImageClick(e, img, flatIdx)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {results && activeTab === 'unassigned' && (
              results.unassigned.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center mt-8">No unassigned images found.</p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                  {results.unassigned.map((img, idx) => (
                    <SearchImageCard
                      key={img.Id}
                      img={img}
                      isSelected={selectedIds.has(img.Id)}
                      onClick={(e) => handleImageClick(e, img, idx)}
                    />
                  ))}
                </div>
              )
            )}
          </div>

          {/* Action bar */}
          {selectedIds.size > 0 && (
            <div className="shrink-0 bg-blue-600 text-white p-2 border-t">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>
                <div className="min-w-[200px]">
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
                <Button size="sm" variant="secondary" className="h-6 text-xs px-2 bg-red-100 hover:bg-red-200 text-red-800" onClick={handleHide}>Hide</Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
                  onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ImagePreviewDialog src={previewSrc} alt="" open={!!previewSrc} onOpenChange={o => { if (!o) setPreviewSrc(null); }} />
    </>
  );
}
