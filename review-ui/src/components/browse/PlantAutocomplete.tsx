import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface PlantSuggestion {
  Id: number;
  Id1: string;
  Canonical_Name: string;
  Category?: string;
}

interface PlantAutocompleteProps {
  /** Label shown before the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Called when an existing plant is selected */
  onSelect: (plant: PlantSuggestion) => void;
  /** Called when a new plant is created and selected. If not provided, create-new flow is disabled. */
  onCreateAndSelect?: (name: string, slug: string) => void;
  /** If true, show a confirm dialog before calling onSelect (e.g. "Move N images to X?") */
  confirmMessage?: (plant: PlantSuggestion) => string;
  /** Confirm button label */
  confirmLabel?: string;
  /** Create-new confirmation message */
  createMessage?: (name: string) => string;
  /** Create button label */
  createLabel?: string;
  /** Plant ID to exclude from results (current plant) */
  excludePlantId?: string;
  /** Reset trigger — changes to this value reset the component state */
  resetKey?: string | number;
  /** External ref to forward to the input element */
  externalInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Additional CSS class for the input */
  inputClassName?: string;
  /** Additional CSS class for the label */
  labelClassName?: string;
  /** Whether to use white background on input (for dark containers) */
  whiteBackground?: boolean;
  /** Dropdown position offset from left (CSS class like 'left-12' or 'left-16') */
  dropdownLeftClass?: string;
  /** Show category in dropdown items */
  showCategory?: boolean;
}

export function PlantAutocomplete({
  label = 'Plant:',
  placeholder = 'Reassign to another plant...',
  onSelect,
  onCreateAndSelect,
  confirmMessage,
  confirmLabel = 'Move',
  createMessage,
  createLabel = 'Create & Move',
  excludePlantId,
  resetKey,
  externalInputRef,
  inputClassName = 'h-7 text-xs',
  labelClassName = 'text-xs font-medium shrink-0',
  whiteBackground = false,
  dropdownLeftClass = 'left-12',
  showCategory = false,
}: PlantAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlantSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showConfirm, setShowConfirm] = useState<PlantSuggestion | null>(null);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);

  // Reset state when resetKey changes
  useEffect(() => {
    setQuery('');
    setShowDropdown(false);
    setShowConfirm(null);
    setShowCreateConfirm(false);
    setHighlightIndex(-1);
  }, [resetKey]);

  useEffect(() => {
    if (showConfirm) confirmRef.current?.focus();
    if (showCreateConfirm) createRef.current?.focus();
  }, [showConfirm, showCreateConfirm]);

  const fetchPlants = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/browse/plants-search?q=${encodeURIComponent(search)}`, { credentials: 'include' });
      if (res.ok) {
        const data: PlantSuggestion[] = await res.json();
        const filtered = excludePlantId ? data.filter((p) => p.Id1 !== excludePlantId) : data;
        setSuggestions(filtered);
        setShowDropdown(filtered.length > 0);
        setHighlightIndex(-1);
      }
    } catch {}
  }, [excludePlantId]);

  const handleChange = (value: string) => {
    setQuery(value);
    setShowConfirm(null);
    setShowCreateConfirm(false);
    setHighlightIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 1) {
      debounceRef.current = setTimeout(() => fetchPlants(value.trim()), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const selectPlant = (plant: PlantSuggestion) => {
    if (confirmMessage) {
      // Show confirmation before calling onSelect
      setQuery(plant.Canonical_Name);
      setShowDropdown(false);
      setHighlightIndex(-1);
      setShowConfirm(plant);
    } else {
      // Immediately select
      setQuery('');
      setShowDropdown(false);
      setHighlightIndex(-1);
      onSelect(plant);
    }
  };

  const handleConfirmedSelect = () => {
    if (!showConfirm) return;
    const plant = showConfirm;
    setShowConfirm(null);
    setQuery('');
    onSelect(plant);
  };

  const handleCreateAndAssign = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const res = await fetch('/api/browse/create-plant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Canonical_Name: trimmed, Id1: slug, Category: 'fruit' }),
      });
      if (res.ok) {
        const plant = await res.json();
        setShowCreateConfirm(false);
        setQuery('');
        if (onCreateAndSelect) {
          onCreateAndSelect(plant.Canonical_Name ?? trimmed, plant.Id1 ?? slug);
        }
      }
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault(); e.stopPropagation();
        if (!showDropdown) setShowDropdown(true);
        setHighlightIndex((prev) => e.key === 'ArrowUp'
          ? (prev <= 0 ? suggestions.length - 1 : prev - 1)
          : (prev >= suggestions.length - 1 ? 0 : prev + 1));
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (showCreateConfirm) {
        handleCreateAndAssign();
      } else if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectPlant(suggestions[highlightIndex]);
      } else {
        const trimmed = query.trim();
        if (!trimmed) return;
        const match = suggestions.find(s => s.Canonical_Name.toLowerCase() === trimmed.toLowerCase());
        if (match) {
          selectPlant(match);
        } else if (onCreateAndSelect) {
          setShowDropdown(false);
          setShowCreateConfirm(true);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (showConfirm) { setShowConfirm(null); }
      else if (showCreateConfirm) { setShowCreateConfirm(false); }
      else { setShowDropdown(false); setQuery(''); inputRef.current?.blur(); }
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {label && <label className={labelClassName}>{label}</label>}
        <div className="relative flex-1">
          <Input
            ref={(el) => {
              (inputRef as any).current = el;
              if (externalInputRef) (externalInputRef as any).current = el;
            }}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim().length >= 1) fetchPlants(query.trim()); }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder={placeholder}
            className={`${inputClassName}${whiteBackground ? ' bg-white text-black' : ''}`}
          />
        </div>
      </div>

      {/* Autocomplete dropdown -- opens upward */}
      {showDropdown && suggestions.length > 0 && (
        <div className={`absolute z-50 bottom-full mb-1 ${dropdownLeftClass} right-0 bg-popover border rounded shadow-lg max-h-40 overflow-y-auto`}>
          {suggestions.map((p, i) => (
            <button
              key={p.Id}
              className={`w-full text-left px-2 py-1.5 text-xs transition-colors ${i === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
              onMouseDown={(e) => { e.preventDefault(); selectPlant(p); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="font-medium">{p.Canonical_Name}</span>
              {showCategory && p.Category && <span className="text-muted-foreground ml-2">{p.Category}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Confirm selection dialog -- opens upward */}
      {showConfirm && (
        <div
          className={`absolute z-50 bottom-full mb-1 ${dropdownLeftClass} right-0 bg-popover border rounded shadow-lg p-3`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleConfirmedSelect(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowConfirm(null); inputRef.current?.focus(); }
          }}
        >
          <p className="text-xs mb-2">
            {confirmMessage ? confirmMessage(showConfirm) : `Move to ${showConfirm.Canonical_Name}?`}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setShowConfirm(null); inputRef.current?.focus(); }}>
              Cancel (Esc)
            </Button>
            <Button ref={confirmRef} size="sm" className="h-6 text-xs" onClick={handleConfirmedSelect}>
              {confirmLabel} (Enter)
            </Button>
          </div>
        </div>
      )}

      {/* Create new plant confirmation -- opens upward */}
      {showCreateConfirm && onCreateAndSelect && (
        <div
          className={`absolute z-50 bottom-full mb-1 ${dropdownLeftClass} right-0 bg-popover border rounded shadow-lg p-3`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleCreateAndAssign(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowCreateConfirm(false); inputRef.current?.focus(); }
          }}
        >
          <p className="text-xs mb-2">
            {createMessage
              ? createMessage(query.trim())
              : <>Plant <strong>&ldquo;{query.trim()}&rdquo;</strong> doesn&apos;t exist. Create it?</>}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setShowCreateConfirm(false); inputRef.current?.focus(); }}>
              Cancel (Esc)
            </Button>
            <Button ref={createRef} size="sm" className="h-6 text-xs" onClick={handleCreateAndAssign}>
              {createLabel} (Enter)
            </Button>
          </div>
        </div>
      )}

      {/* No matches hint when create is available */}
      {!showConfirm && !showCreateConfirm && showDropdown && suggestions.length === 0 && query.trim().length >= 2 && onCreateAndSelect && (
        <div className={`absolute z-50 bottom-full mb-1 ${dropdownLeftClass} right-0 bg-popover border rounded shadow-lg p-2`}>
          <p className="text-xs text-muted-foreground">No matches. Press Enter to create &ldquo;<span className="font-bold">{query.trim()}</span>&rdquo;</p>
        </div>
      )}
    </div>
  );
}

// ── Simple Plant Reassign Field (for Documents/Attachments) ──────────────────
// This is a simpler variant that immediately calls an API endpoint on selection
// without confirmation dialogs or create-new flow.

interface SimplePlantReassignFieldProps {
  itemId: number;
  endpoint: string;
  onReassigned: (plantId: string) => void;
  inputClassName?: string;
  placeholder?: string;
}

export function SimplePlantReassignField({ itemId, endpoint, onReassigned, inputClassName = 'h-8 text-xs', placeholder = 'Move to plant...' }: SimplePlantReassignFieldProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ Id1: string; Canonical_Name: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); setShowDropdown(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/browse/plants-search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setResults(data);
          setShowDropdown(data.length > 0);
          setSelectedIdx(-1);
        }
      } catch {}
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleSelect = async (plant: { Id1: string; Canonical_Name: string }) => {
    try {
      const res = await fetch(`/api/browse/${endpoint}/${itemId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plant_id: plant.Id1 }),
      });
      if (res.ok) {
        onReassigned(plant.Id1);
        setQuery('');
        setShowDropdown(false);
      }
    } catch {}
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) { e.preventDefault(); handleSelect(results[selectedIdx]); }
          else if (e.key === 'Escape') { setShowDropdown(false); setQuery(''); }
        }}
        onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        className={inputClassName}
      />
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg mb-1 max-h-40 overflow-y-auto">
          {results.map((p, i) => (
            <div
              key={p.Id1}
              className={`px-2 py-1 text-xs cursor-pointer hover:bg-accent ${i === selectedIdx ? 'bg-accent' : ''}`}
              onMouseDown={() => handleSelect(p)}
            >
              {p.Canonical_Name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
