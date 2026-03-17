import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PlantTagListProps {
  plants: string[];
  onChange: (plants: string[]) => void;
}

export function PlantTagList({ plants, onChange }: PlantTagListProps) {
  const [newPlant, setNewPlant] = useState('');

  const removePlant = (index: number) => {
    onChange(plants.filter((_, i) => i !== index));
  };

  const addPlant = () => {
    const trimmed = newPlant.trim();
    if (!trimmed || plants.includes(trimmed)) return;
    onChange([...plants, trimmed]);
    setNewPlant('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPlant();
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Plant Associations</Label>
      <div className="flex flex-wrap gap-1.5">
        {plants.map((plant, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-sm"
          >
            {plant}
            <button
              onClick={() => removePlant(i)}
              className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              x
            </button>
          </span>
        ))}
        {plants.length === 0 && (
          <span className="text-sm text-muted-foreground">No plants associated</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={newPlant}
          onChange={(e) => setNewPlant(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add plant association..."
          className="flex-1"
        />
        <Button variant="outline" size="sm" onClick={addPlant} disabled={!newPlant.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
