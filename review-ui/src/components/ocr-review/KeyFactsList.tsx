import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { KeyFact } from '@/types/api';

interface KeyFactsListProps {
  facts: KeyFact[];
  onChange: (facts: KeyFact[]) => void;
}

export function KeyFactsList({ facts, onChange }: KeyFactsListProps) {
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');

  const toggleStatus = (index: number) => {
    const updated = facts.map((fact, i) =>
      i === index
        ? { ...fact, status: fact.status === 'keep' ? 'remove' as const : 'keep' as const }
        : fact
    );
    onChange(updated);
  };

  const removeFact = (index: number) => {
    onChange(facts.filter((_, i) => i !== index));
  };

  const addFact = () => {
    if (!newField.trim() || !newValue.trim()) return;
    onChange([...facts, { field: newField.trim(), value: newValue.trim(), status: 'keep' }]);
    setNewField('');
    setNewValue('');
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Key Facts</Label>
      <div className="space-y-1">
        {facts.map((fact, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              fact.status === 'remove' ? 'opacity-50 line-through bg-muted' : ''
            }`}
          >
            <span className="font-medium min-w-[100px] shrink-0">{fact.field}</span>
            <span className="flex-1 truncate">{fact.value}</span>
            <Button
              variant={fact.status === 'keep' ? 'outline' : 'secondary'}
              size="sm"
              className="h-6 px-2 text-xs shrink-0"
              onClick={() => toggleStatus(i)}
            >
              {fact.status === 'keep' ? 'Keep' : 'Removed'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground shrink-0"
              onClick={() => removeFact(i)}
            >
              x
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder="Field name"
          className="flex-1"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className="flex-1"
        />
        <Button variant="outline" size="sm" onClick={addFact} disabled={!newField.trim() || !newValue.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
