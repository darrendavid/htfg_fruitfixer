import { useState } from 'react';
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
import { toast } from 'sonner';
import type { BrowseNutrient } from '@/types/browse';

interface NutritionTabProps {
  plantId: string;
  nutritional: BrowseNutrient[];
  editMode: boolean;
  onNutritionalChanged: (data: BrowseNutrient[]) => void;
}

interface EditRow {
  Id: number | null;
  Nutrient_Name: string;
  Value: string;
  Unit: string;
  Per_Serving: string;
  Source: string;
}

export function NutritionTab({ plantId, nutritional, editMode, onNutritionalChanged }: NutritionTabProps) {
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = () => {
    setEditRows(
      nutritional.map((n) => ({
        Id: n.Id,
        Nutrient_Name: n.Nutrient_Name,
        Value: n.Value,
        Unit: n.Unit,
        Per_Serving: n.Per_Serving,
        Source: n.Source,
      }))
    );
    setIsEditing(true);
  };

  const addRow = () => {
    setEditRows((prev) => [
      ...prev,
      { Id: null, Nutrient_Name: '', Value: '', Unit: '', Per_Serving: '', Source: '' },
    ]);
  };

  const updateRow = (index: number, field: keyof EditRow, value: string) => {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRow = async (index: number) => {
    const row = editRows[index];
    if (row.Id) {
      try {
        await fetch(`/api/browse/nutritional/${row.Id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch {
        toast.error('Failed to delete nutrient');
        return;
      }
    }
    setEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const results: BrowseNutrient[] = [];
      for (const row of editRows) {
        if (!row.Nutrient_Name.trim()) continue;
        const body = {
          Nutrient_Name: row.Nutrient_Name,
          Value: row.Value,
          Unit: row.Unit,
          Per_Serving: row.Per_Serving,
          Source: row.Source,
        };
        let res: Response;
        if (row.Id) {
          res = await fetch(`/api/browse/nutritional/${row.Id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
        } else {
          res = await fetch(`/api/browse/${plantId}/nutritional`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
        }
        if (res.ok) {
          const data = await res.json();
          results.push(data.nutrient ?? { ...body, Id: row.Id ?? 0, Plant_Id: plantId });
        }
      }
      onNutritionalChanged(results);
      setIsEditing(false);
      toast.success('Nutritional data updated');
    } catch {
      toast.error('Failed to save nutritional data');
    } finally {
      setIsSaving(false);
    }
  };

  if (nutritional.length === 0 && !editMode) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No nutritional data</p>
      </div>
    );
  }

  if (editMode && isEditing) {
    return (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nutrient</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Per Serving</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editRows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input value={row.Nutrient_Name} onChange={(e) => updateRow(i, 'Nutrient_Name', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Input value={row.Value} onChange={(e) => updateRow(i, 'Value', e.target.value)} className="w-20" />
                </TableCell>
                <TableCell>
                  <Input value={row.Unit} onChange={(e) => updateRow(i, 'Unit', e.target.value)} className="w-16" />
                </TableCell>
                <TableCell>
                  <Input value={row.Per_Serving} onChange={(e) => updateRow(i, 'Per_Serving', e.target.value)} className="w-24" />
                </TableCell>
                <TableCell>
                  <Input value={row.Source} onChange={(e) => updateRow(i, 'Source', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => removeRow(i)} className="text-destructive">
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>Add Row</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save All'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {editMode && (
        <Button size="sm" onClick={startEditing}>Edit Nutrition</Button>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nutrient</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Per Serving</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nutritional.map((n) => (
            <TableRow key={n.Id}>
              <TableCell className="font-medium">{n.Nutrient_Name}</TableCell>
              <TableCell>{n.Value}</TableCell>
              <TableCell>{n.Unit}</TableCell>
              <TableCell>{n.Per_Serving}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{n.Source}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
