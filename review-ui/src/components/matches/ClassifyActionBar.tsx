import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';

interface ActionButton {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}

interface PlantPickerAction {
  placeholder: string;
  onSelect: (plant: PlantSuggestion) => void;
  onCreateAndSelect?: (name: string, slug: string) => Promise<void>;
  createMessage?: (name: string) => string;
  createLabel?: string;
  excludePlantId?: string;
}

interface ClassifyActionBarProps {
  selectedCount: number;
  sidebarWidth?: number;  // default 0 (full width)
  buttons?: ActionButton[];
  plantPicker?: PlantPickerAction;
  children?: React.ReactNode;
  onClear: () => void;
}

export function ClassifyActionBar({
  selectedCount, sidebarWidth = 0, buttons = [], plantPicker, children, onClear
}: ClassifyActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-12 right-0 z-50 bg-blue-600 text-white p-2 shadow-lg"
      style={{ left: sidebarWidth }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium shrink-0">{selectedCount} selected</span>
        {plantPicker && (
          <div className="min-w-[180px]">
            <PlantAutocomplete
              label=""
              placeholder={plantPicker.placeholder}
              inputClassName="h-6 text-xs bg-white text-black"
              dropdownLeftClass="left-0"
              excludePlantId={plantPicker.excludePlantId}
              onSelect={plantPicker.onSelect}
              onCreateAndSelect={plantPicker.onCreateAndSelect
                ? async (name, slug) => plantPicker.onCreateAndSelect!(name, slug)
                : undefined}
              createMessage={plantPicker.createMessage}
              createLabel={plantPicker.createLabel}
            />
          </div>
        )}
        {children}
        {buttons.map((btn, i) => (
          <Button
            key={i}
            size="sm"
            variant="secondary"
            className={`h-6 text-xs px-2 ${btn.className ?? ''}`}
            onClick={btn.onClick}
            disabled={btn.disabled}
          >
            {btn.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
