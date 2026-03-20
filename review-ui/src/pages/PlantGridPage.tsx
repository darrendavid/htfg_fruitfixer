import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

const PAGE_SIZE = 24;

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'nut', label: 'Nut' },
  { value: 'spice', label: 'Spice' },
  { value: 'flower', label: 'Flower' },
  { value: 'other', label: 'Other' },
];

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
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

function saveGridState(state: { search: string; category: string; sort: string; page: number; scrollY: number }) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function PlantGridPage() {
  const saved = useRef(loadGridState());
  const [plants, setPlants] = useState<BrowsePlant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState(saved.current?.search ?? '');
  const [category, setCategory] = useState(saved.current?.category ?? 'all');
  const [sort, setSort] = useState(saved.current?.sort ?? 'name_asc');
  const [page, setPage] = useState(saved.current?.page ?? 1);
  const [totalPages, setTotalPages] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.current?.search ?? '');
  const restoredScroll = useRef(false);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [category, sort]);

  const fetchPlants = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (category !== 'all') params.set('category', category);

      const res = await fetch(`/api/browse?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPlants(data.plants);
        const total = data.pageInfo?.totalRows ?? 0;
        setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
      }
    } catch {
      // Network error — leave current state
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, category, sort]);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  // Save grid state on every change (for back-navigation restoration)
  useEffect(() => {
    saveGridState({ search, category, sort, page, scrollY: window.scrollY });
  }, [search, category, sort, page]);

  // Save scroll position on scroll (throttled)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          saveGridState({ search, category, sort, page, scrollY: window.scrollY });
          ticking = false;
        });
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [search, category, sort, page]);

  // Restore scroll position after data loads (only once)
  useEffect(() => {
    if (!isLoading && plants.length > 0 && !restoredScroll.current && saved.current?.scrollY) {
      restoredScroll.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.current!.scrollY);
      });
    }
  }, [isLoading, plants.length]);

  return (
    <AuthGuard>
      <AppShell title="Plants">
        <div className="p-4 space-y-4">
          {/* Search + Filters */}
          <div className="space-y-2">
            <Input
              placeholder="Search plants..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full"
            />
            <div className="flex gap-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Loading skeleton */}
          {isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-square w-full rounded-lg" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && plants.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-lg text-muted-foreground">No plants found</p>
              {debouncedSearch && (
                <p className="text-sm text-muted-foreground mt-1">
                  Try adjusting your search or filters
                </p>
              )}
            </div>
          )}

          {/* Plant grid */}
          {!isLoading && plants.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {plants.map((plant) => (
                <PlantCard key={plant.Id} plant={plant} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
