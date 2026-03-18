import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import type { BrowseVariety } from '@/types/browse';

interface VarietiesTabProps {
  plantId: string;
  varieties: BrowseVariety[];
  editMode: boolean;
  onVarietiesChanged: (varieties: BrowseVariety[]) => void;
}

interface EditRow {
  Id: number | null; // null for new rows
  Variety_Name: string;
  Characteristics: string;
  Tasting_Notes: string;
  Source: string;
}

export function VarietiesTab({ plantId, varieties, editMode, onVarietiesChanged }: VarietiesTabProps) {
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = () => {
    setEditRows(
      varieties.map((v) => ({
        Id: v.Id,
        Variety_Name: v.Variety_Name,
        Characteristics: v.Characteristics ?? '',
        Tasting_Notes: v.Tasting_Notes ?? '',
        Source: v.Source ?? '',
      }))
    );
    setIsEditing(true);
  };

  const addRow = () => {
    setEditRows((prev) => [
      ...prev,
      { Id: null, Variety_Name: '', Characteristics: '', Tasting_Notes: '', Source: '' },
    ]);
  };

  const updateRow = (index: number, field: keyof EditRow, value: string) => {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRow = async (index: number) => {
    const row = editRows[index];
    if (row.Id) {
      try {
        await fetch(`/api/browse/varieties/${row.Id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch {
        toast.error('Failed to delete variety');
        return;
      }
    }
    setEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const results: BrowseVariety[] = [];
      for (const row of editRows) {
        if (!row.Variety_Name.trim()) continue;
        const body = {
          Variety_Name: row.Variety_Name,
          Characteristics: row.Characteristics || null,
          Tasting_Notes: row.Tasting_Notes || null,
          Source: row.Source || null,
        };
        let res: Response;
        if (row.Id) {
          res = await fetch(`/api/browse/varieties/${row.Id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
        } else {
          res = await fetch(`/api/browse/${plantId}/varieties`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
        }
        if (res.ok) {
          const data = await res.json();
          results.push(data.variety ?? { ...body, Id: row.Id ?? 0, Plant_Id: plantId });
        }
      }
      onVarietiesChanged(results);
      setIsEditing(false);
      toast.success('Varieties updated');
    } catch {
      toast.error('Failed to save varieties');
    } finally {
      setIsSaving(false);
    }
  };

  if (varieties.length === 0 && !editMode) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No varieties recorded</p>
      </div>
    );
  }

  if (editMode && isEditing) {
    return (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Characteristics</TableHead>
              <TableHead>Tasting Notes</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editRows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={row.Variety_Name}
                    onChange={(e) => updateRow(i, 'Variety_Name', e.target.value)}
                    className="min-w-[120px]"
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    value={row.Characteristics}
                    onChange={(e) => updateRow(i, 'Characteristics', e.target.value)}
                    rows={2}
                    className="min-w-[120px]"
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    value={row.Tasting_Notes}
                    onChange={(e) => updateRow(i, 'Tasting_Notes', e.target.value)}
                    rows={2}
                    className="min-w-[120px]"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.Source}
                    onChange={(e) => updateRow(i, 'Source', e.target.value)}
                    className="min-w-[80px]"
                  />
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
        <Button size="sm" onClick={startEditing}>Edit Varieties</Button>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Characteristics</TableHead>
            <TableHead>Tasting Notes</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {varieties.map((v) => (
            <TableRow key={v.Id}>
              <TableCell className="font-medium">{v.Variety_Name}</TableCell>
              <TableCell className="text-sm">{v.Characteristics ?? '-'}</TableCell>
              <TableCell className="text-sm">{v.Tasting_Notes ?? '-'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{v.Source ?? '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
