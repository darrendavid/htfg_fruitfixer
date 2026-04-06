import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ViewMode = 'card' | 'list';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  className?: string;
}

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div className={`inline-flex border rounded-md ${className ?? ''}`} role="group" aria-label="View mode">
      <Button
        type="button"
        variant={value === 'card' ? 'default' : 'ghost'}
        size="icon"
        className="h-8 w-8 rounded-r-none"
        onClick={() => onChange('card')}
        title="Card view"
        aria-pressed={value === 'card'}
        data-testid="view-toggle-card"
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        type="button"
        variant={value === 'list' ? 'default' : 'ghost'}
        size="icon"
        className="h-8 w-8 rounded-l-none"
        onClick={() => onChange('list')}
        title="List view"
        aria-pressed={value === 'list'}
        data-testid="view-toggle-list"
      >
        <List className="size-4" />
      </Button>
    </div>
  );
}
