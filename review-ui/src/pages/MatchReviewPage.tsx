import { useState, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchCard } from '@/components/matches/match-card';
import type { MatchGroup, MatchItem, MatchesResponse, UndoToken } from '@/types/matches';
import type { PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import type { VarietySelection } from '@/components/browse/VarietyAutocomplete';

export function MatchReviewPage() {
  const [groups, setGroups] = useState<MatchGroup[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, matched: 0, approved: 0, reviewed: 0, ignored: 0 });
  const cardRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());

  // Flat list of visible items for keyboard navigation
  const visibleItems = selectedFolder
    ? (groups.find((g) => g.folder === selectedFolder)?.matches ?? [])
    : groups.flatMap((g) => g.matches);

  useEffect(() => {
    fetch('/api/matches', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: MatchesResponse) => {
        setGroups(data.groups);
        setStats((s) => ({ ...s, total: data.total, matched: data.matched }));
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Scroll active card into view
  useEffect(() => {
    const item = visibleItems[activeIndex];
    if (!item) return;
    const ref = cardRefs.current.get(item.file_path);
    ref?.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeItem = useCallback((filePath: string) => {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, matches: g.matches.filter((m) => m.file_path !== filePath) }))
        .filter((g) => g.matches.length > 0)
    );
  }, []);

  const pushUndo = useCallback((token: UndoToken) => {
    setUndoStack((prev) => [...prev.slice(-19), token]);
  }, []);

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
      // Reload groups to restore the item
      const data: MatchesResponse = await fetch('/api/matches', { credentials: 'include' }).then((r) => r.json());
      setGroups(data.groups);
    } catch {
      alert('Undo failed.');
    }
  }, [undoStack]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); return; }

      const item = visibleItems[activeIndex];
      if (e.key === 'a' && item) { handleApprove(item, { Id: 0, Id1: item.plant_id, Canonical_Name: item.plant_name }, item.variety_id != null && item.variety_name ? { id: item.variety_id, name: item.variety_name } : null); return; }
      if (e.key === 'r' && item) { handleReview(item); return; }
      if (e.key === 'i' && item) { handleIgnore(item); return; }
      if ((e.key === 'ArrowDown' || e.key === 'j') && activeIndex < visibleItems.length - 1) { e.preventDefault(); setActiveIndex((i) => i + 1); }
      if ((e.key === 'ArrowUp' || e.key === 'k') && activeIndex > 0) { e.preventDefault(); setActiveIndex((i) => i - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIndex, visibleItems, handleApprove, handleReview, handleIgnore, handleUndo]);

  const totalRemaining = groups.reduce((n, g) => n + g.matches.length, 0);
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
          <button
            className={`w-full text-left px-3 py-2 text-xs transition-colors border-b ${selectedFolder === null ? 'bg-accent font-medium' : 'hover:bg-muted'}`}
            onClick={() => { setSelectedFolder(null); setActiveIndex(0); }}
          >
            All folders
            <span className="float-right text-muted-foreground">{totalRemaining}</span>
          </button>
          {groups.map((g) => (
            <button
              key={g.folder}
              className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${selectedFolder === g.folder ? 'bg-accent font-medium' : 'hover:bg-muted'}`}
              onClick={() => { setSelectedFolder(g.folder); setActiveIndex(0); }}
              title={g.folder}
            >
              {g.folder}
              <span className="float-right text-muted-foreground">{g.matches.length}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Right panel — match cards */}
      <main className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <Skeleton key={n} className="h-32 w-full rounded-lg" />)}
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No items to review.</p>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item, idx) => {
              if (!cardRefs.current.has(item.file_path)) {
                cardRefs.current.set(item.file_path, { current: null } as React.RefObject<HTMLDivElement | null>);
              }
              return (
                <MatchCard
                  key={item.file_path}
                  item={item}
                  isActive={idx === activeIndex}
                  cardRef={cardRefs.current.get(item.file_path)}
                  onApprove={handleApprove}
                  onReview={handleReview}
                  onIgnore={handleIgnore}
                  onClick={() => setActiveIndex(idx)}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
