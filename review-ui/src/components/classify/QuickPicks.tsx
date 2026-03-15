import { Button } from '@/components/ui/button';
import type { Plant } from '@/types/api';

interface QuickPicksProps {
  plants: Plant[];
  onSelect: (plant: Plant) => void;
}

export function QuickPicks({ plants, onSelect }: QuickPicksProps) {
  if (plants.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Quick picks:</p>
      <div className="flex flex-wrap gap-2">
        {plants.map((plant) => (
          <Button
            key={plant.id}
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onSelect(plant)}
          >
            {plant.common_name}
          </Button>
        ))}
      </div>
    </div>
  );
}
