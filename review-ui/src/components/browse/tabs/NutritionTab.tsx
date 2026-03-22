import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { BrowseNutrient } from '@/types/browse';

interface NutritionTabProps {
  plantId: string;
  nutritional: BrowseNutrient[];
  editMode: boolean;
  onNutritionalChanged: (data: BrowseNutrient[]) => void;
}

export function NutritionTab({ plantId, nutritional, editMode, onNutritionalChanged }: NutritionTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<BrowseNutrient>>({});

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNutrient, setNewNutrient] = useState({ Nutrient_Name: '', Value: '', Unit: '', Per_Serving: '', Source: '' });
  const [isAdding, setIsAdding] = useState(false);

  // ── Inline edit ─────────────────────────────────────────────────────────────
  const startEdit = (n: BrowseNutrient) => {
    setEditingId(n.Id);
    setEditValues({ Nutrient_Name: n.Nutrient_Name, Value: n.Value, Unit: n.Unit, Per_Serving: n.Per_Serving, Source: n.Source });
  };

  const cancelEdit = () => { setEditingId(null); setEditValues({}); };

  const saveEdit = useCallback(async () => {
    if (editingId === null) return;
    try {
      const res = await fetch(`/api/browse/nutritional/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
        credentials: 'include',
      });
      if (res.ok) {
        const updated = await res.json();
        onNutritionalChanged(nutritional.map(n => n.Id === editingId ? { ...n, ...updated } : n));
        toast.success('Updated');
      } else {
        toast.error('Failed to update');
      }
    } catch {
      toast.error('Failed to update');
    }
    setEditingId(null);
    setEditValues({});
  }, [editingId, editValues, nutritional, onNutritionalChanged]);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteNutrient = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/browse/nutritional/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        onNutritionalChanged(nutritional.filter(n => n.Id !== id));
        toast.success('Deleted');
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
  }, [nutritional, onNutritionalChanged]);

  // ── Add ─────────────────────────────────────────────────────────────────────
  const addNutrient = useCallback(async () => {
    if (!newNutrient.Nutrient_Name.trim()) return;
    setIsAdding(true);
    try {
      const res = await fetch(`/api/browse/${plantId}/nutritional`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNutrient),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Fetch full record if only Id returned
        let full = data;
        if (!data.Nutrient_Name && data.Id) {
          const r = await fetch(`/api/browse/nutritional/${data.Id}`, { credentials: 'include' }).catch(() => null);
          // Nutritional doesn't have a GET by ID, just use local data
          full = { ...newNutrient, Id: data.Id, Plant_Id: plantId };
        }
        onNutritionalChanged([...nutritional, full]);
        setNewNutrient({ Nutrient_Name: '', Value: '', Unit: '', Per_Serving: '', Source: '' });
        setShowAddForm(false);
        toast.success('Added');
      } else {
        toast.error('Failed to add');
      }
    } catch {
      toast.error('Failed to add');
    } finally {
      setIsAdding(false);
    }
  }, [newNutrient, plantId, nutritional, onNutritionalChanged]);

  if (nutritional.length === 0 && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No nutritional data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      {isAdmin && (
        <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
          + Add Nutrient
        </Button>
      )}

      {/* Add form */}
      {showAddForm && isAdmin && (
        <div className="grid grid-cols-6 gap-2 p-3 bg-muted/50 rounded items-end">
          <div>
            <label className="text-xs text-muted-foreground">Nutrient</label>
            <Input value={newNutrient.Nutrient_Name} onChange={e => setNewNutrient(p => ({ ...p, Nutrient_Name: e.target.value }))} placeholder="e.g. Protein" className="h-8 text-sm" autoFocus />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Value</label>
            <Input value={newNutrient.Value} onChange={e => setNewNutrient(p => ({ ...p, Value: e.target.value }))} placeholder="e.g. 2.5" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Unit</label>
            <Input value={newNutrient.Unit} onChange={e => setNewNutrient(p => ({ ...p, Unit: e.target.value }))} placeholder="e.g. g" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Per Serving</label>
            <Input value={newNutrient.Per_Serving} onChange={e => setNewNutrient(p => ({ ...p, Per_Serving: e.target.value }))} placeholder="e.g. per 100g" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Source</label>
            <Input value={newNutrient.Source} onChange={e => setNewNutrient(p => ({ ...p, Source: e.target.value }))} placeholder="Source" className="h-8 text-sm" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" onClick={addNutrient} disabled={isAdding || !newNutrient.Nutrient_Name.trim()} className="h-8">
              {isAdding ? '...' : 'Add'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="h-8">Cancel</Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {nutritional.length === 0 && isAdmin && !showAddForm && (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <p className="text-muted-foreground mb-2">No nutritional data</p>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>+ Add First Nutrient</Button>
        </div>
      )}

      {/* Table */}
      {nutritional.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nutrient</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Per Serving</TableHead>
              <TableHead>Source</TableHead>
              {isAdmin && <TableHead className="w-28"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {nutritional.map(n => (
              <TableRow key={n.Id}>
                {editingId === n.Id ? (
                  <>
                    <TableCell><Input value={editValues.Nutrient_Name ?? ''} onChange={e => setEditValues(p => ({ ...p, Nutrient_Name: e.target.value }))} className="h-7 text-sm" /></TableCell>
                    <TableCell><Input value={editValues.Value ?? ''} onChange={e => setEditValues(p => ({ ...p, Value: e.target.value }))} className="h-7 text-sm w-20" /></TableCell>
                    <TableCell><Input value={editValues.Unit ?? ''} onChange={e => setEditValues(p => ({ ...p, Unit: e.target.value }))} className="h-7 text-sm w-16" /></TableCell>
                    <TableCell><Input value={editValues.Per_Serving ?? ''} onChange={e => setEditValues(p => ({ ...p, Per_Serving: e.target.value }))} className="h-7 text-sm w-24" /></TableCell>
                    <TableCell><Input value={editValues.Source ?? ''} onChange={e => setEditValues(p => ({ ...p, Source: e.target.value }))} className="h-7 text-sm" /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={saveEdit}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelEdit}>Cancel</Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="font-medium">{n.Nutrient_Name}</TableCell>
                    <TableCell>{n.Value}</TableCell>
                    <TableCell>{n.Unit}</TableCell>
                    <TableCell>{n.Per_Serving}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{n.Source}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(n)} className="text-muted-foreground hover:text-foreground" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                              <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.15 7.375a.75.75 0 0 0-.2.38l-.5 2.25a.75.75 0 0 0 .896.896l2.25-.5a.75.75 0 0 0 .38-.2l4.862-4.862a1.75 1.75 0 0 0 0-2.475Z" />
                              <path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z" />
                            </svg>
                          </button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => deleteNutrient(n.Id)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
