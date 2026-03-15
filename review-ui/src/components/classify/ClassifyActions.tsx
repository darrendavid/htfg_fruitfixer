import { Button } from '@/components/ui/button';
import type { Plant } from '@/types/api';

interface ClassifyActionsProps {
  selectedPlant: Plant | null;
  onAssign: () => void;
  onNewPlant: () => void;
  onDiscard: () => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

export function ClassifyActions({ selectedPlant, onAssign, onNewPlant, onDiscard, onSkip, isSubmitting }: ClassifyActionsProps) {
  return (
    <div className="space-y-2 px-4">
      <Button
        className="w-full min-h-[44px]"
        onClick={onAssign}
        disabled={!selectedPlant || isSubmitting}
      >
        ✓ Assign to Plant{selectedPlant ? `: ${selectedPlant.common_name}` : ''}
      </Button>
      <Button variant="outline" className="w-full min-h-[44px]" onClick={onNewPlant} disabled={isSubmitting}>
        + New Plant Entry
      </Button>
      <Button variant="outline" className="w-full min-h-[44px] text-destructive border-destructive/30" onClick={onDiscard} disabled={isSubmitting}>
        ✕ Not a Plant
      </Button>
      <Button variant="ghost" className="w-full min-h-[44px] text-muted-foreground" onClick={onSkip} disabled={isSubmitting}>
        ⏭ Skip
      </Button>
    </div>
  );
}
