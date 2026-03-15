import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import type { Plant } from '@/types/api';

interface PlantSearchProps {
  onSelect: (plant: Plant) => void;
  selectedPlant: Plant | null;
}

export function PlantSearch({ onSelect, selectedPlant }: PlantSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Plant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/plants?search=${encodeURIComponent(query)}`, {
          credentials: 'include',
        });
        const data = await res.json();
        setResults(data.plants ?? []);
        setIsOpen(true);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function handleSelect(plant: Plant) {
    onSelect(plant);
    setQuery(plant.common_name);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <Input
        placeholder="🔍 Search plants..."
        value={selectedPlant ? selectedPlant.common_name : query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (selectedPlant) onSelect(null as any); // clear selection on type
        }}
        onFocus={() => query.length >= 2 && setIsOpen(true)}
        className="text-base"
      />
      {isLoading && (
        <div className="absolute right-3 top-2.5 text-xs text-muted-foreground">Searching...</div>
      )}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {results.map((plant) => (
            <button
              key={plant.id}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(plant)}
            >
              <p className="text-sm font-medium">{plant.common_name}</p>
              {plant.botanical_names && (
                <p className="text-xs text-muted-foreground italic">{plant.botanical_names}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {isOpen && !isLoading && results.length === 0 && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg px-3 py-2 text-sm text-muted-foreground">
          No plants found
        </div>
      )}
    </div>
  );
}
