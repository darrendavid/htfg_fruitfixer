import { useState, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MatchCard } from '@/components/matches/match-card';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import type { FolderSummary, FoldersResponse, FolderItemsResponse, MatchItem, UndoToken } from '@/types/matches';

export function MatchReviewPage() {
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [folderCounts, setFolderCounts] = useState<Map<string, number>>(new Map());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderItems, setFolderItems] = useState<MatchItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoToken[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [stats, setStats] = useState({ approved: 0, reviewed: 0, ignored: 0 });
  const cardRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());
  const loadingFolderRef = useRef<string | null>(null);

  // Multi-select state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  // Bulk action plant/variety state
  const [bulkPlant, setBulkPlant] = useState<PlantSuggestion | null>(null);
  const [bulkVariety, setBulkVariety] = useState<VarietySelection | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Refs for current state — read inside setTimeout callbacks where closure values are stale
  const foldersRef = useRef<FolderSummary[]>([]);
  const folderCountsRef = useRef<Map<string, number>>(new Map());
  const selectedFolderRef = useRef<string | null>(null);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { folderCountsRef.current = folderCounts; }, [folderCounts]);
  useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);

  // ── Fetch folder list on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/matches', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: FoldersResponse) => {
        setFolders(data.groups);
        setTotalRemaining(data.total);
        setFolderCounts(new Map(data.groups.map((g) => [g.folder, g.count])));
        if (data.groups.length > 0) loadFolder(data.groups[0].folder);
      })
      .catch(() => {})
      .finally(() => setIsLoadingFolders(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load items for a specific folder ──────────────────────────────────────
  const loadFolder = useCallback((folder: string) => {
    setSelectedFolder(folder);
    setIsLoadingItems(true);
    setFolderItems([]);
    setActiveIndex(0);
    setSelectedPaths(new Set());
    setBulkPlant(null);
    setBulkVariety(null);
    cardRefs.current.clear();
    loadingFolderRef.current = folder;

    fetch(`/api/matches?folder=${encodeURIComponent(folder)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: FolderItemsResponse) => {
        if (loadingFolderRef.current !== folder) return;
        setFolderItems(data.items);
      })
      .catch(() => {})
      .finally(() => {
        if (loadingFolderRef.current === folder) setIsLoadingItems(false);
      });
  }, []);

  // ── Schedule auto-advance to the next non-empty folder ────────────────────
  const scheduleAdvance = useCallback((fromFolder: string) => {
    setTimeout(() => {
      if (selectedFolderRef.current !== fromFolder) return;
      const fs = foldersRef.current;
      const fc = folderCountsRef.current;
      const currentIdx = fs.findIndex((f) => f.folder === fromFolder);
      const next = fs.slice(currentIdx + 1).find((f) => (fc.get(f.folder) ?? f.count) > 0);
      if (next) loadFolder(next.folder);
    }, 600);
  }, [loadFolder]);

  // ── Remove items from view + decrement counts ──────────────────────────────
  const removeItems = useCallback((filePaths: string[]) => {
    const pathSet = new Set(filePaths);
    const newItems = folderItems.filter((m) => !pathSet.has(m.file_path));
    setFolderItems(newItems);
    setTotalRemaining((n) => Math.max(0, n - filePaths.length));
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const p of filePaths) next.delete(p);
      return next;
    });
    const sf = selectedFolderRef.current;
    if (sf) {
      setFolderCounts((prev) => {
        const next = new Map(prev);
        next.set(sf, Math.max(0, (next.get(sf) ?? filePaths.length) - filePaths.length));
        return next;
      });
      if (newItems.length === 0) scheduleAdvance(sf);
    }
  }, [folderItems, scheduleAdvance]);

  const removeItem = useCallback((filePath: string) => removeItems([filePath]), [removeItems]);

  const pushUndo = useCallback((token: UndoToken) => {
    setUndoStack((prev) => [...prev.slice(-19), token]);
  }, []);

  // ── Single-item actions ────────────────────────────────────────────────────
  const handleAttach = useCallback(async (item: MatchItem, plant: PlantSuggestion): Promise<UndoToken | null> => {
    try {
      const res = await fetch('/api/matches/attach', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: item.file_path, plant_id: plant.Id1, filename: item.filename }),
      });
      if (!res.ok) throw new Error('attach failed');
      const data = await res.json();
      removeItem(item.file_path);
      pushUndo(data.undo_token);
      setStats((s) => ({ ...s, approved: s.approved + 1 }));
      return data.undo_token;
    } catch {
      alert('Failed to attach item.');
      return null;
    }
  }, [removeItem, pushUndo]);

  const handleApprove = useCallback(async (item: MatchItem, plant: PlantSuggestion, variety: VarietySelection | null): Promise<UndoToken | null> => {
    try {
      const res = await fetch('/api/matches/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: item.file_path, plant_id: plant.Id1, variety_id: variety?.id ?? null, filename: item.filename }),
      });
      if (!res.ok) throw new Error('approve failed');
      const data = await res.json();
      removeItem(item.file_path);
      pushUndo(data.undo_token);
      setStats((s) => ({ ...s, approved: s.approved + 1 }));
      return data.undo_token;
    } catch {
      alert('Failed to approve item.');
      return null;
    }
  }, [removeItem, pushUndo]);

  const handleReview = useCallback(async (item: MatchItem): Promise<UndoToken | null> => {
    try {
      const res = await fetch('/api/matches/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: item.file_path, filename: item.filename }),
      });
      if (!res.ok) throw new Error('review failed');
      const data = await res.json();
      removeItem(item.file_path);
      pushUndo(data.undo_token);
      setStats((s) => ({ ...s, reviewed: s.reviewed + 1 }));
      return data.undo_token;
    } catch {
      alert('Failed to send item to triage.');
      return null;
    }
  }, [removeItem, pushUndo]);

  const handleIgnore = useCallback(async (item: MatchItem): Promise<UndoToken | null> => {
    try {
      const res = await fetch('/api/matches/ignore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: item.file_path, filename: item.filename }),
      });
      if (!res.ok) throw new Error('ignore failed');
      const data = await res.json();
      removeItem(item.file_path);
      pushUndo(data.undo_token);
      setStats((s) => ({ ...s, ignored: s.ignored + 1 }));
      return data.undo_token;
    } catch {
      alert('Failed to ignore item.');
      return null;
    }
  }, [removeItem, pushUndo]);

  // ── Bulk actions ───────────────────────────────────────────────────────────
  const handleBulkApprove = useCallback(async (plant: PlantSuggestion, variety: VarietySelection | null) => {
    if (selectedPaths.size === 0 || bulkBusy) return;
    const items = folderItems.filter((m) => selectedPaths.has(m.file_path))
      .map((m) => ({ file_path: m.file_path, filename: m.filename }));
    setBulkBusy(true);
    try {
      const res = await fetch('/api/matches/bulk-approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, plant_id: plant.Id1, variety_id: variety?.id ?? null }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`bulk-approve ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      const succeeded = (data.results as any[]).filter((r) => r.success).map((r) => r.file_path as string);
      removeItems(succeeded);
      setStats((s) => ({ ...s, approved: s.approved + succeeded.length }));
      setBulkPlant(null);
      setBulkVariety(null);
    } catch (err: any) {
      alert(`Bulk approve failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedPaths, folderItems, bulkBusy, removeItems]);

  const handleBulkIgnore = useCallback(async () => {
    if (selectedPaths.size === 0 || bulkBusy) return;
    const items = folderItems.filter((m) => selectedPaths.has(m.file_path))
      .map((m) => ({ file_path: m.file_path, filename: m.filename }));
    setBulkBusy(true);
    try {
      const res = await fetch('/api/matches/bulk-ignore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`bulk-ignore ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      const succeeded = (data.results as any[]).filter((r) => r.success).map((r) => r.file_path as string);
      removeItems(succeeded);
      setStats((s) => ({ ...s, ignored: s.ignored + succeeded.length }));
    } catch (err: any) {
      alert(`Bulk ignore failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedPaths, folderItems, bulkBusy, removeItems]);

  // ── Bulk set (prefill plant/variety on selected cards — no server call) ────
  const handleBulkSet = useCallback((plant: PlantSuggestion, variety: VarietySelection | null) => {
    setFolderItems((prev) => prev.map((item) => {
      if (!selectedPaths.has(item.file_path)) return item;
      return {
        ...item,
        plant_id: plant.Id1,
        plant_name: plant.Canonical_Name,
        variety_id: variety?.id ?? null,
        variety_name: variety?.name ?? null,
      };
    }));
    setSelectedPaths(new Set());
    setBulkPlant(null);
    setBulkVariety(null);
  }, [selectedPaths]);

  const handleUndo = useCallback(async () => {
    const token = undoStack[undoStack.length - 1];
    if (!token) return;
    try {
      const res = await fetch('/api/matches/undo', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo_token: token }),
      });
      if (!res.ok) throw new Error('undo failed');
      setUndoStack((prev) => prev.slice(0, -1));
      if (selectedFolderRef.current) loadFolder(selectedFolderRef.current);
    } catch {
      alert('Undo failed.');
    }
  }, [undoStack, loadFolder]);

  // ── Card click handler — ctrl/shift/plain ─────────────────────────────────
  const handleCardClick = useCallback((item: MatchItem, idx: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(item.file_path)) next.delete(item.file_path);
        else { next.add(item.file_path); setLastClickedIdx(idx); }
        return next;
      });
      setActiveIndex(idx);
    } else if (e.shiftKey && lastClickedIdx !== null) {
      e.preventDefault();
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          if (folderItems[i]) next.add(folderItems[i].file_path);
        }
        return next;
      });
      setActiveIndex(idx);
    } else {
      setActiveIndex(idx);
      setLastClickedIdx(idx);
    }
  }, [lastClickedIdx, folderItems]);

  // ── Scroll active card into view ───────────────────────────────────────────
  useEffect(() => {
    const item = folderItems[activeIndex];
    if (!item) return;
    const ref = cardRefs.current.get(item.file_path);
    ref?.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); return; }

      // Escape clears selection
      if (e.key === 'Escape' && selectedPaths.size > 0) {
        setSelectedPaths(new Set());
        return;
      }

      const item = folderItems[activeIndex];
      if (e.key === 'a' && item && item.plant_id && item.plant_name) {
        const plant = { Id: 0, Id1: item.plant_id, Canonical_Name: item.plant_name };
        if (item.file_type === 'document') handleAttach(item, plant);
        else handleApprove(item, plant, item.variety_id != null && item.variety_name ? { id: item.variety_id, name: item.variety_name } : null);
        return;
      }
      if (e.key === 'r' && item) { handleReview(item); return; }
      if (e.key === 'i' && item) { handleIgnore(item); return; }
      if ((e.key === 'ArrowDown' || e.key === 'j') && activeIndex < folderItems.length - 1) { e.preventDefault(); setActiveIndex((i) => i + 1); }
      if ((e.key === 'ArrowUp' || e.key === 'k') && activeIndex > 0) { e.preventDefault(); setActiveIndex((i) => i - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIndex, folderItems, selectedPaths, handleApprove, handleAttach, handleReview, handleIgnore, handleUndo]);

  const processed = stats.approved + stats.reviewed + stats.ignored;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left sidebar — folder list */}
      <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold">Match Review</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {totalRemaining} remaining · {processed} done
          </p>
          {processed > 0 && (
            <p className="text-xs text-muted-foreground">
              {stats.approved} approved · {stats.reviewed} triage · {stats.ignored} ignored
            </p>
          )}
          {undoStack.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1 italic">Ctrl+Z to undo ({undoStack.length})</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoadingFolders ? (
            <div className="p-3 space-y-1">
              {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-7 w-full" />)}
            </div>
          ) : (
            folders.map((f) => {
              const liveCount = folderCounts.get(f.folder) ?? f.count;
              const isDone = liveCount === 0;
              return (
                <button
                  key={f.folder}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${
                    selectedFolder === f.folder ? 'bg-accent font-medium' : isDone ? 'opacity-40 hover:bg-muted' : 'hover:bg-muted'
                  }`}
                  onClick={() => loadFolder(f.folder)}
                  title={f.folder}
                >
                  {f.displayName}
                  <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {isDone ? '✓' : liveCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right panel — match cards */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {!selectedFolder ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a folder to begin reviewing.</p>
        ) : isLoadingItems ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <Skeleton key={n} className="h-32 w-full rounded-lg" />)}
          </div>
        ) : folderItems.length === 0 ? (
          <div className="text-center mt-12">
            <p className="text-sm font-medium text-green-700">Folder complete</p>
            <p className="text-xs text-muted-foreground mt-1">Advancing to next folder…</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">
              <span className="font-medium">{selectedFolder}</span> · {folderItems.length} items
              {selectedPaths.size > 0 && (
                <span className="ml-2 text-blue-600 font-medium">· {selectedPaths.size} selected (Esc to clear)</span>
              )}
            </p>
            {folderItems.map((item, idx) => {
              if (!cardRefs.current.has(item.file_path)) {
                cardRefs.current.set(item.file_path, { current: null } as React.RefObject<HTMLDivElement | null>);
              }
              return (
                <MatchCard
                  key={`${item.file_path}:${item.plant_id ?? ''}:${item.variety_id ?? ''}`}
                  item={item}
                  isActive={idx === activeIndex}
                  isSelected={selectedPaths.has(item.file_path)}
                  cardRef={cardRefs.current.get(item.file_path)}
                  onApprove={handleApprove}
                  onAttach={handleAttach}
                  onReview={handleReview}
                  onIgnore={handleIgnore}
                  onClick={(e) => handleCardClick(item, idx, e)}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Bulk selection action bar */}
      {selectedPaths.size > 0 && (
        <div className="fixed bottom-0 left-[250px] right-0 z-50 bg-blue-600 text-white p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedPaths.size} selected</span>

            {/* Plant selector */}
            <div className="flex items-center gap-1 min-w-[180px]">
              <span className="text-[10px] font-medium shrink-0">Fruit:</span>
              <PlantAutocomplete
                label=""
                placeholder={bulkPlant ? bulkPlant.Canonical_Name : 'Assign plant...'}
                onSelect={(plant) => { setBulkPlant(plant); setBulkVariety(null); }}
                onCreateAndSelect={(name, slug) => { setBulkPlant({ Id: 0, Id1: slug, Canonical_Name: name }); setBulkVariety(null); }}
                createMessage={(name) => `Create plant "${name}"?`}
                createLabel="Create"
                resetKey={`bulk-${selectedFolder}`}
                dropdownLeftClass="left-0"
                inputClassName="h-6 text-xs bg-white text-black"
              />
            </div>

            {/* Variety selector — only shown once a plant is chosen */}
            {bulkPlant && (
              <div className="flex items-center gap-1 min-w-[280px] [&_input]:bg-white [&_input]:text-black [&_label]:text-white">
                <VarietyPicker
                  plantId={bulkPlant.Id1}
                  currentVariety={bulkVariety?.name ?? null}
                  onSelect={(v) => setBulkVariety(v)}
                />
              </div>
            )}

            {/* Set (prefill) button — updates cards without approving */}
            {bulkPlant && (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 text-xs px-2"
                onClick={() => handleBulkSet(bulkPlant, bulkVariety)}
              >
                Set {selectedPaths.size}
              </Button>
            )}

            {/* Approve button */}
            {bulkPlant && (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 text-xs px-2 bg-green-100 hover:bg-green-200 text-green-800"
                disabled={bulkBusy}
                onClick={() => handleBulkApprove(bulkPlant, bulkVariety)}
              >
                {bulkBusy ? 'Approving…' : `Approve ${selectedPaths.size}`}
              </Button>
            )}

            {/* Ignore button */}
            <Button
              size="sm"
              variant="secondary"
              className="h-6 text-xs px-2"
              disabled={bulkBusy}
              onClick={handleBulkIgnore}
            >
              {bulkBusy ? '…' : `Ignore ${selectedPaths.size}`}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
              onClick={() => setSelectedPaths(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
