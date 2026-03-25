import type { ThumbSize } from '@/hooks/use-thumb-size';

const SIZES: { value: ThumbSize; label: string }[] = [
  { value: 'lg', label: 'L' },
  { value: 'md', label: 'M' },
  { value: 'sm', label: 'S' },
];

interface ThumbSizeToggleProps {
  value: ThumbSize;
  onChange: (size: ThumbSize) => void;
}

export function ThumbSizeToggle({ value, onChange }: ThumbSizeToggleProps) {
  return (
    <div className="flex border rounded overflow-hidden">
      {SIZES.map((s) => (
        <button
          key={s.value}
          onClick={() => onChange(s.value)}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            value === s.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-muted-foreground hover:bg-muted'
          }`}
          title={`${s.label === 'L' ? 'Large' : s.label === 'M' ? 'Medium' : 'Small'} thumbnails`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
