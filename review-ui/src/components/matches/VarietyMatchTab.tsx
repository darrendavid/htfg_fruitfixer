import { useState, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { VarietyMatchCard } from './variety-match-card';
import type { VarietyMatchItem, VarietyMatchGroup, VarietyMatchGroupsResponse, VarietyMatchItemsResponse, UndoToken } from '@/types/matches';

export function VarietyMatchTab() {
  const [groups, setGroups] = useState<VarietyMatchGroup[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [items, setItems] = useState<VarietyMatchItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [totalSuggestions, setTotalSuggestions] = useState(0);
  const [stats, setStats] = useState({ accepted: 0, skipped: 0 });
  const [undoStack, setUndoStack] = useState<UndoToken[]>([]);
  const cardRefs = useRef<Map<number, React.RefObject<HTMLDivElement | null>>>(new Map());

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Live counts per plant
  const [plantCounts, setPlantCounts] = useState<Map<string, number>>(new Map());

  // ── Fetch groups on mount ─────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/matches/variety-suggestions', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: VarietyMatchGroupsResponse) => {
        setGroups(data.groups);
        setTotalSuggestions(data.total);
        setPlantCounts(new Map(data.groups.map((g) => [g.plant_id, g.count])));
        if (data.groups.length > 0) loadPlant(data.groups[0].plant_id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingGroups(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load items for a plant ────────────────────────────────────────────────
  const loadPlant = useCallback((plantId: string) => {
    setSelectedPlant(plantId);
    setIsLoadingItems(true);
    setItems([]);
    setActiveIndex(0);
    setSelectedIds(new Set());
    cardRefs.current.clear();

    fetch(`/api/matches/variety-suggestions?plant=${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: VarietyMatchItemsResponse) => {
        setItems(data.items);
      })
      .catch(() => {})
      .finally(() => setIsLoadingItems(false));
  }, []);

  // ── Remove item from view ─────────────────────────────────────────────────
  const removeItem = useCallback((imageId: number) => {
    setItems((prev) => prev.filter((m) => m.image_id !== imageId));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(imageId); return n; });
    setTotalSuggestions((n) => Math.max(0, n - 1));
    if (selectedPlant) {
      setPlantCounts((prev) => {
        const next = new Map(prev);
        next.set(selectedPlant, Math.max(0, (next.get(selectedPlant) ?? 1) - 1));
        return next;
      });
    }
  }, [selectedPlant]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleAccept = useCallback(async (item: VarietyMatchItem, varietyId: number, _varietyName: string) => {
    try {
      const res = await fetch('/api/matches/accept-variety', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: item.image_id, variety_id: varietyId }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      removeItem(item.image_id);
      setUndoStack((prev) => [...prev.slice(-19), data.undo_token]);
      setStats((s) => ({ ...s, accepted: s.accepted + 1 }));
    } catch { alert('Failed to accept variety.'); }
  }, [removeItem]);

  const handleSkip = useCallback((item: VarietyMatchItem) => {
    removeItem(item.image_id);
    setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
  }, [removeItem]);

  const handleHide = useCallback(async (item: VarietyMatchItem) => {
    try {
      const res = await fetch('/api/browse/bulk-set-status', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [item.image_id], status: 'hidden' }),
      });
      if (!res.ok) throw new Error();
      removeItem(item.image_id);
      setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    } catch { alert('Failed to hide image.'); }
  }, [removeItem]);

  const handleBulkAccept = useCallback(async () => {
    if (selectedIds.size === 0 || bulkBusy) return;
    const selected = items.filter((m) => selectedIds.has(m.image_id));
    setBulkBusy(true);
    try {
      const body = { items: selected.map((m) => ({ image_id: m.image_id, variety_id: m.variety_id })) };
      const res = await fetch('/api/matches/bulk-accept-variety', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      for (const m of selected) removeItem(m.image_id);
      setStats((s) => ({ ...s, accepted: s.accepted + selected.length }));
    } catch { alert('Bulk accept failed.'); }
    finally { setBulkBusy(false); }
  }, [selectedIds, items, bulkBusy, removeItem]);

  const handleUndo = useCallback(async () => {
    const token = undoStack[undoStack.length - 1];
    if (!token) return;
    try {
      const res = await fetch('/api/matches/undo', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo_token: token }),
      });
      if (!res.ok) throw new Error();
      setUndoStack((prev) => prev.slice(0, -1));
      if (selectedPlant) loadPlant(selectedPlant);
    } catch { alert('Undo failed.'); }
  }, [undoStack, selectedPlant, loadPlant]);

  // ── Card click handler ────────────────────────────────────────────────────
  const handleCardClick = useCallback((item: VarietyMatchItem, idx: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.image_id)) next.delete(item.image_id);
        else { next.add(item.image_id); setLastClickedIdx(idx); }
        return next;
      });
      setActiveIndex(idx);
    } else if (e.shiftKey && lastClickedIdx !== null) {
      e.preventDefault();
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) if (items[i]) next.add(items[i].image_id);
        return next;
      });
      setActiveIndex(idx);
    } else {
      setActiveIndex(idx);
      setLastClickedIdx(idx);
    }
  }, [lastClickedIdx, items]);

  // ── Scroll active card into view ──────────────────────────────────────────
  useEffect(() => {
    const item = items[activeIndex];
    if (!item) return;
    const ref = cardRefs.current.get(item.image_id);
    ref?.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
      if (e.key === 'Escape' && selectedIds.size > 0) { setSelectedIds(new Set()); return; }

      const item = items[activeIndex];
      if (e.key === 'a' && item) { handleAccept(item, item.variety_id, item.variety_name); return; }
      if (e.key === 'h' && item) { handleHide(item); return; }
      if (e.key === 's' && item) { handleSkip(item); return; }
      if ((e.key === 'ArrowDown' || e.key === 'j') && activeIndex < items.length - 1) { e.preventDefault(); setActiveIndex((i) => i + 1); }
      if ((e.key === 'ArrowUp' || e.key === 'k') && activeIndex > 0) { e.preventDefault(); setActiveIndex((i) => i - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIndex, items, selectedIds, handleAccept, handleHide, handleSkip, handleUndo]);

  const processed = stats.accepted + stats.skipped;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — plant groups */}
      <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold">Variety Suggestions</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {totalSuggestions} suggestions · {processed} done
          </p>
          {processed > 0 && (
            <p className="text-xs text-muted-foreground">
              {stats.accepted} accepted · {stats.skipped} skipped
            </p>
          )}
          {undoStack.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1 italic">Ctrl+Z to undo ({undoStack.length})</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoadingGroups ? (
            <div className="p-3 space-y-1">
              {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-7 w-full" />)}
            </div>
          ) : (
            groups.map((g) => {
              const liveCount = plantCounts.get(g.plant_id) ?? g.count;
              const isDone = liveCount === 0;
              return (
                <button
                  key={g.plant_id}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${
                    selectedPlant === g.plant_id ? 'bg-accent font-medium' : isDone ? 'opacity-40 hover:bg-muted' : 'hover:bg-muted'
                  }`}
                  onClick={() => loadPlant(g.plant_id)}
                  title={g.plant_name}
                >
                  {g.plant_name}
                  <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {isDone ? '✓' : liveCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right panel */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {!selectedPlant ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a plant to begin reviewing variety suggestions.</p>
        ) : isLoadingItems ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <Skeleton key={n} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center mt-12">
            <p className="text-sm font-medium text-green-700">All suggestions reviewed for this plant</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">
              <span className="font-medium">{groups.find(g => g.plant_id === selectedPlant)?.plant_name ?? selectedPlant}</span> · {items.length} suggestions
              {selectedIds.size > 0 && (
                <span className="ml-2 text-blue-600 font-medium">· {selectedIds.size} selected (Esc to clear)</span>
              )}
            </p>
            {items.map((item, idx) => {
              if (!cardRefs.current.has(item.image_id)) {
                cardRefs.current.set(item.image_id, { current: null } as React.RefObject<HTMLDivElement | null>);
              }
              return (
                <VarietyMatchCard
                  key={item.image_id}
                  item={item}
                  isActive={idx === activeIndex}
                  isSelected={selectedIds.has(item.image_id)}
                  cardRef={cardRefs.current.get(item.image_id)}
                  onAccept={handleAccept}
                  onHide={handleHide}
                  onSkip={handleSkip}
                  onClick={(e) => handleCardClick(item, idx, e)}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Bulk selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-[250px] right-0 z-50 bg-green-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{selectedIds.size} selected</span>
            <Button size="sm" variant="secondary" className="h-6 text-xs px-3" disabled={bulkBusy}
              onClick={handleBulkAccept}>
              {bulkBusy ? 'Accepting...' : `Accept ${selectedIds.size} suggestions`}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-green-700 ml-auto"
              onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
