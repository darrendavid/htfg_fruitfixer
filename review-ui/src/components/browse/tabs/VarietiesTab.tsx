import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { BrowseVariety } from '@/types/browse';

interface VarietiesTabProps {
  plantId: string;
  varieties: BrowseVariety[];
  editMode: boolean;
  onVarietiesChanged: (varieties: BrowseVariety[]) => void;
}

export function VarietiesTab({ plantId, varieties, editMode, onVarietiesChanged }: VarietiesTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Add variety state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Merge dialog state
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setPrimaryId(null);
  };

  // ── Inline rename ───────────────────────────────────────────────────────────
  const startRename = (v: BrowseVariety) => {
    setRenamingId(v.Id);
    setRenameValue(v.Variety_Name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const saveRename = useCallback(async () => {
    if (renamingId === null || !renameValue.trim()) return;
    try {
      const res = await fetch(`/api/browse/varieties/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variety_Name: renameValue.trim() }),
        credentials: 'include',
      });
      if (res.ok) {
        onVarietiesChanged(varieties.map(v =>
          v.Id === renamingId ? { ...v, Variety_Name: renameValue.trim() } : v
        ));
        toast.success('Variety renamed');
      } else {
        toast.error('Failed to rename');
      }
    } catch {
      toast.error('Failed to rename');
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, varieties, onVarietiesChanged]);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteVariety = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/browse/varieties/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        onVarietiesChanged(varieties.filter(v => v.Id !== id));
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        toast.success('Variety deleted');
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
  }, [varieties, onVarietiesChanged]);

  // ── Add variety ─────────────────────────────────────────────────────────────
  const addVariety = useCallback(async () => {
    if (!newName.trim()) return;
    setIsAdding(true);
    try {
      const res = await fetch(`/api/browse/${plantId}/varieties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variety_Name: newName.trim() }),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        onVarietiesChanged([...varieties, data]);
        setNewName('');
        setShowAddForm(false);
        toast.success('Variety added');
      } else {
        toast.error('Failed to add variety');
      }
    } catch {
      toast.error('Failed to add variety');
    } finally {
      setIsAdding(false);
    }
  }, [newName, plantId, varieties, onVarietiesChanged]);

  // ── Merge ───────────────────────────────────────────────────────────────────
  const openMergeDialog = () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least 2 varieties to merge');
      return;
    }
    setPrimaryId(null);
    setShowMergeDialog(true);
  };

  const executeMerge = useCallback(async () => {
    if (!primaryId) return;
    setIsMerging(true);
    try {
      const mergeIds = [...selectedIds].filter(id => id !== primaryId);
      const res = await fetch('/api/browse/varieties/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: primaryId, merge_ids: mergeIds }),
        credentials: 'include',
      });
      if (res.ok) {
        const result = await res.json();
        // Remove merged varieties from local state, keep primary
        onVarietiesChanged(varieties.filter(v => !mergeIds.includes(v.Id)));
        clearSelection();
        setShowMergeDialog(false);
        toast.success(`Merged ${result.merged_count} varieties into "${result.primary}"`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Merge failed');
      }
    } catch {
      toast.error('Merge failed');
    } finally {
      setIsMerging(false);
    }
  }, [primaryId, selectedIds, varieties, onVarietiesChanged]);

  const selectedVarieties = varieties.filter(v => selectedIds.has(v.Id));

  if (varieties.length === 0 && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No varieties recorded</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
            + Add Variety
          </Button>
          {selectedIds.size >= 2 && (
            <Button size="sm" variant="default" onClick={openMergeDialog}>
              Merge {selectedIds.size} Varieties
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear Selection ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Add form */}
      {showAddForm && isAdmin && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New variety name..."
            className="max-w-xs"
            onKeyDown={e => { if (e.key === 'Enter') addVariety(); if (e.key === 'Escape') { setShowAddForm(false); setNewName(''); } }}
            autoFocus
          />
          <Button size="sm" onClick={addVariety} disabled={isAdding || !newName.trim()}>
            {isAdding ? 'Adding...' : 'Add'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setNewName(''); }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Empty state with add button */}
      {varieties.length === 0 && isAdmin && !showAddForm && (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <p className="text-muted-foreground mb-2">No varieties recorded</p>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            + Add First Variety
          </Button>
        </div>
      )}

      {/* Table */}
      {varieties.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && <TableHead className="w-10"></TableHead>}
              <TableHead>Name</TableHead>
              <TableHead>Genome Group</TableHead>
              <TableHead>Characteristics</TableHead>
              <TableHead>Tasting Notes</TableHead>
              <TableHead>Source</TableHead>
              {isAdmin && <TableHead className="w-28"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {varieties.map(v => (
              <TableRow key={v.Id} className={selectedIds.has(v.Id) ? 'bg-blue-50 dark:bg-blue-950/30' : ''}>
                {/* Select checkbox */}
                {isAdmin && (
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(v.Id)}
                      onChange={() => toggleSelect(v.Id)}
                      className="h-4 w-4 accent-blue-600 cursor-pointer"
                    />
                  </TableCell>
                )}

                {/* Name — inline editable */}
                <TableCell className="font-medium">
                  {renamingId === v.Id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        className="h-7 text-sm min-w-[140px]"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') cancelRename(); }}
                      />
                      <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={saveRename}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelRename}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="select-text">{v.Variety_Name}</span>
                      {isAdmin && (
                        <button
                          onClick={() => startRename(v)}
                          className="text-muted-foreground hover:text-foreground ml-1"
                          title="Rename variety"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                            <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.15 7.375a.75.75 0 0 0-.2.38l-.5 2.25a.75.75 0 0 0 .896.896l2.25-.5a.75.75 0 0 0 .38-.2l4.862-4.862a1.75 1.75 0 0 0 0-2.475Z" />
                            <path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-sm">{(v as any).Genome_Group ?? '-'}</TableCell>
                <TableCell className="text-sm">{v.Characteristics ?? '-'}</TableCell>
                <TableCell className="text-sm">{v.Tasting_Notes ?? '-'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{v.Source ?? '-'}</TableCell>

                {/* Actions */}
                {isAdmin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => deleteVariety(v.Id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Merge dialog */}
      <Dialog open={showMergeDialog} onOpenChange={open => { if (!open) setShowMergeDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>Merge Varieties</DialogTitle>
          <p className="text-sm text-muted-foreground mb-4">
            Select the primary variety. Images and metadata from the other {selectedVarieties.length - 1} varieties will be reassigned to it, and the others will be deleted.
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {selectedVarieties.map(v => (
              <label
                key={v.Id}
                className={`flex items-center gap-3 p-2 rounded cursor-pointer border transition-colors ${
                  primaryId === v.Id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-transparent hover:bg-muted/50'
                }`}
                onClick={() => setPrimaryId(v.Id)}
              >
                <input
                  type="radio"
                  name="primary"
                  checked={primaryId === v.Id}
                  onChange={() => setPrimaryId(v.Id)}
                  className="accent-blue-600"
                />
                <div>
                  <span className="font-medium">{v.Variety_Name}</span>
                  {primaryId === v.Id && (
                    <Badge variant="default" className="ml-2 text-xs">Primary</Badge>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!primaryId || isMerging}
              onClick={executeMerge}
            >
              {isMerging ? 'Merging...' : `Merge into "${selectedVarieties.find(v => v.Id === primaryId)?.Variety_Name ?? '...'}"`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
