import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlantCard } from '@/components/browse/PlantCard';
import type { BrowsePlant } from '@/types/browse';

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'nut', label: 'Nut' },
  { value: 'spice', label: 'Spice' },
  { value: 'flower', label: 'Flower' },
  { value: 'other', label: 'Other' },
];

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'A-Z' },
  { value: 'name_desc', label: 'Z-A' },
  { value: 'images_desc', label: 'Most Images' },
];

const STORAGE_KEY = 'htfg_plant_grid_state';

function loadGridState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveGridState(state: { search: string; category: string; sort: string; scrollY: number }) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function PlantGridPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const saved = useRef(loadGridState());
  const [allPlants, setAllPlants] = useState<BrowsePlant[]>([]);
  const [showNewPlant, setShowNewPlant] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBotanical, setNewBotanical] = useState('');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState(saved.current?.search ?? '');
  const [category, setCategory] = useState(saved.current?.category ?? 'all');
  const [sort, setSort] = useState(saved.current?.sort ?? 'name_asc');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.current?.search ?? '');
  const restoredScroll = useRef(false);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Fetch all plants once (no pagination)
  const fetchPlants = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all pages
      let all: BrowsePlant[] = [];
      let page = 1;
      while (true) {
        const params = new URLSearchParams({ page: String(page), limit: '200', sort });
        const res = await fetch(`/api/browse?${params}`, { credentials: 'include' });
        if (!res.ok) break;
        const data = await res.json();
        all.push(...data.plants);
        if (data.pageInfo?.isLastPage || data.plants.length === 0) break;
        page++;
      }
      setAllPlants(all);
    } catch {
      // Network error
    } finally {
      setIsLoading(false);
    }
  }, [sort]);

  useEffect(() => { fetchPlants(); }, [fetchPlants]);

  // Client-side filter and sort
  const filteredPlants = allPlants.filter(p => {
    if (category !== 'all' && p.Category !== category) return false;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      const name = p.Canonical_Name?.toLowerCase() ?? '';
      const botanical = (p.Botanical_Name ?? '').toLowerCase();
      const aliases = (p.Aliases ?? '').toLowerCase();
      if (!name.includes(q) && !botanical.includes(q) && !aliases.includes(q)) return false;
    }
    return true;
  });

  // Save grid state on every change
  useEffect(() => {
    saveGridState({ search, category, sort, scrollY: window.scrollY });
  }, [search, category, sort]);

  // Save scroll position on scroll (throttled)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          saveGridState({ search, category, sort, scrollY: window.scrollY });
          ticking = false;
        });
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [search, category, sort]);

  // Restore scroll position after data loads (only once)
  useEffect(() => {
    if (!isLoading && allPlants.length > 0 && !restoredScroll.current && saved.current?.scrollY) {
      restoredScroll.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.current!.scrollY);
      });
    }
  }, [isLoading, allPlants.length]);

  const handleCreatePlant = useCallback(async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      // Create the plant
      const res = await fetch('/api/browse/create-plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          Canonical_Name: newName.trim(),
          Botanical_Name: newBotanical.trim() || null,
          Category: 'fruit',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create plant');
        setIsCreating(false);
        return;
      }
      const created = await res.json();
      // Get the slug
      const detailRes = await fetch(`/api/browse/${created.Id}`, { credentials: 'include' });
      const detail = detailRes.ok ? await detailRes.json() : null;
      const slug = detail?.plant?.Id1 || created.Id;

      // Upload images if any
      if (newFiles.length > 0) {
        const formData = new FormData();
        newFiles.forEach(f => formData.append('images', f));
        await fetch(`/api/browse/upload-images/${slug}`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
      }

      toast.success(`Created "${newName.trim()}"`);
      setShowNewPlant(false);
      setNewName('');
      setNewBotanical('');
      setNewFiles([]);
      // Navigate to the new plant
      navigate(`/plants/${slug}`);
    } catch {
      toast.error('Failed to create plant');
    } finally {
      setIsCreating(false);
    }
  }, [newName, newBotanical, newFiles, navigate]);

  return (
    <AuthGuard>
      <AppShell title="Plants">
        <div className="p-4 space-y-4">
          {/* Search + Category + Sort — single row */}
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Search plants..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button size="sm" className="shrink-0" onClick={() => setShowNewPlant(true)}>
                + New Plant
              </Button>
            )}
          </div>

          {/* Count */}
          {!isLoading && (
            <p className="text-xs text-muted-foreground">{filteredPlants.length} plants</p>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-square w-full rounded-lg" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && filteredPlants.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-lg text-muted-foreground">No plants found</p>
              {debouncedSearch && (
                <p className="text-sm text-muted-foreground mt-1">
                  Try adjusting your search or filters
                </p>
              )}
            </div>
          )}

          {/* Plant grid — all plants, lazy-loaded images */}
          {!isLoading && filteredPlants.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredPlants.map((plant) => (
                <PlantCard key={plant.Id} plant={plant} />
              ))}
            </div>
          )}
        </div>

        {/* New Plant Dialog */}
        <Dialog open={showNewPlant} onOpenChange={(open) => { if (!open) { setShowNewPlant(false); setNewName(''); setNewBotanical(''); setNewFiles([]); } }}>
          <DialogContent className="max-w-md">
            <DialogTitle>New Plant</DialogTitle>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Dragon Fruit"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreatePlant(); }}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Scientific Name</label>
                <Input
                  value={newBotanical}
                  onChange={e => setNewBotanical(e.target.value)}
                  placeholder="e.g. Hylocereus undatus"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Initial Photos (optional)</label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center border-muted-foreground/30 hover:border-muted-foreground/50 transition-colors"
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation();
                    const files = Array.from(e.dataTransfer.files).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f.name));
                    setNewFiles(prev => [...prev, ...files]);
                  }}
                >
                  <Upload className="size-6 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Drag & drop or{' '}
                    <label className="text-blue-600 hover:text-blue-800 underline cursor-pointer">
                      browse
                      <input type="file" multiple accept="image/*" className="sr-only"
                        onChange={e => { setNewFiles(prev => [...prev, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
                    </label>
                  </p>
                </div>
                {newFiles.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                    {newFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                        <span className="truncate mr-2">{f.name}</span>
                        <button className="text-destructive shrink-0" onClick={() => setNewFiles(prev => prev.filter((_, j) => j !== i))}>&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => { setShowNewPlant(false); setNewName(''); setNewBotanical(''); setNewFiles([]); }}>
                Cancel
              </Button>
              <Button onClick={handleCreatePlant} disabled={isCreating || !newName.trim()}>
                {isCreating ? 'Creating...' : `Create${newFiles.length > 0 ? ` + ${newFiles.length} photo${newFiles.length !== 1 ? 's' : ''}` : ''}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AuthGuard>
  );
}
