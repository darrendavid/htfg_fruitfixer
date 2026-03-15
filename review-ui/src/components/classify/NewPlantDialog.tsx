import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Plant } from '@/types/api';

interface NewPlantDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (plant: Plant) => Promise<void>;
}

export function NewPlantDialog({ open, onClose, onCreate }: NewPlantDialogProps) {
  const [form, setForm] = useState({
    common_name: '',
    botanical_name: '',
    category: 'fruit',
    aliases: '',
  });
  const [csvMatch, setCsvMatch] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check CSV candidates as user types
  useEffect(() => {
    if (form.common_name.length < 2) { setCsvMatch(null); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plants/csv-candidates?search=${encodeURIComponent(form.common_name)}`, { credentials: 'include' });
        const data = await res.json();
        if (data.candidates?.length > 0) {
          const match = data.candidates[0];
          setCsvMatch(match);
          // Auto-fill botanical name if empty
          if (!form.botanical_name && (match.scientific_name || match.genus)) {
            setForm(f => ({ ...f, botanical_name: match.scientific_name || match.genus || '' }));
          }
        } else {
          setCsvMatch(null);
        }
      } catch { setCsvMatch(null); }
    }, 400);
    return () => clearTimeout(timeout);
  }, [form.common_name]);

  async function handleCreate() {
    if (!form.common_name.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plants/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          common_name: form.common_name.trim(),
          botanical_name: form.botanical_name.trim() || undefined,
          category: form.category,
          aliases: form.aliases.trim() || undefined,
        }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create plant');
        return;
      }
      await onCreate(data.plant);
      setForm({ common_name: '', botanical_name: '', category: 'fruit', aliases: '' });
      setCsvMatch(null);
      onClose();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Plant</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {csvMatch && (
            <Alert>
              <AlertDescription>
                CSV match found: "{csvMatch.fruit_type || csvMatch.common_name}"
                {csvMatch.scientific_name && ` (${csvMatch.scientific_name})`}
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor="common_name">Common Name *</Label>
            <Input id="common_name" value={form.common_name} onChange={e => setForm(f => ({ ...f, common_name: e.target.value }))} autoFocus required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="botanical_name">Botanical Name</Label>
            <Input id="botanical_name" value={form.botanical_name} onChange={e => setForm(f => ({ ...f, botanical_name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['fruit', 'nut', 'spice', 'flower', 'other'].map(c => (
                  <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aliases">Aliases (comma-separated)</Label>
            <Input id="aliases" value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))} placeholder="e.g. lilikoi, passion fruit" />
          </div>
          <p className="text-xs text-amber-600">⚠ This will flag Phase 4B for re-run when threshold is reached.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!form.common_name.trim() || isLoading}>
            {isLoading ? 'Creating...' : 'Create & Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
