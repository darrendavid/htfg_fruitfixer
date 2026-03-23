import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
  const saved = useRef(loadGridState());
  const [allPlants, setAllPlants] = useState<BrowsePlant[]>([]);
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
        if (data.pageInfo?.isLastPage || data.plants.length < 200) break;
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
      </AppShell>
    </AuthGuard>
  );
}
