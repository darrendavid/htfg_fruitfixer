import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const CATEGORIES = [
  { value: 'event', label: 'Event / Conference' },
  { value: 'graphics', label: 'UI / Graphics / Logo' },
  { value: 'travel', label: 'Travel / People' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'poor_quality', label: 'Poor Quality' },
];

interface DiscardDialogProps {
  open: boolean;
  onClose: () => void;
  onDiscard: (category: string, notes: string | null) => Promise<void>;
}

export function DiscardDialog({ open, onClose, onDiscard }: DiscardDialogProps) {
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleDiscard() {
    if (!category) return;
    setIsLoading(true);
    try {
      await onDiscard(category, notes || null);
      setCategory('');
      setNotes('');
      onClose();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why isn't this a plant?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <RadioGroup value={category} onValueChange={setCategory}>
            {CATEGORIES.map((c) => (
              <div key={c.value} className="flex items-center space-x-2">
                <RadioGroupItem value={c.value} id={c.value} />
                <Label htmlFor={c.value} className="cursor-pointer">{c.label}</Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDiscard}
            disabled={!category || isLoading}
          >
            {isLoading ? 'Discarding...' : 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
