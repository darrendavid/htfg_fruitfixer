import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BrowseVariety } from '@/types/browse';

// ── Variety Picker (autocomplete with create-new) ────────────────────────────

interface VarietyPickerProps {
  plantId: string;
  currentVariety: string | null;
  externalInputRef?: React.RefObject<HTMLInputElement | null>;
  onSelect: (name: string | null) => void;
}

export function VarietyPicker({ plantId, currentVariety, externalInputRef, onSelect }: VarietyPickerProps) {
  const [query, setQuery] = useState(currentVariety ?? '');
  const [suggestions, setSuggestions] = useState<BrowseVariety[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Sync when lightbox image changes
  useEffect(() => {
    setQuery(currentVariety ?? '');
    setShowDropdown(false);
    setShowConfirm(false);
    setHighlightIndex(-1);
  }, [currentVariety]);

  // Focus confirm button when it appears
  useEffect(() => {
    if (showConfirm) confirmRef.current?.focus();
  }, [showConfirm]);

  const fetchVarieties = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/browse/${plantId}/varieties-search?q=${encodeURIComponent(search)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        setShowDropdown(data.length > 0);
        setHighlightIndex(-1);
      }
    } catch {
      // ignore
    }
  }, [plantId]);

  const handleChange = (value: string) => {
    setQuery(value);
    setShowConfirm(false);
    setHighlightIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 1) {
      debounceRef.current = setTimeout(() => fetchVarieties(value.trim()), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const handleSelectExisting = (variety: BrowseVariety) => {
    setQuery(variety.Variety_Name);
    setShowDropdown(false);
    setHighlightIndex(-1);
    onSelect(variety.Variety_Name);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Arrow keys for autocomplete navigation -- works if suggestions exist
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        // Ensure dropdown is visible
        if (!showDropdown) setShowDropdown(true);
        if (e.key === 'ArrowUp') {
          setHighlightIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        } else {
          setHighlightIndex((prev) => (prev >= suggestions.length - 1 ? 0 : prev + 1));
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      // If a dropdown item is highlighted, select it
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        handleSelectExisting(suggestions[highlightIndex]);
        return;
      }

      const trimmed = query.trim();
      if (!trimmed) {
        onSelect(null);
        return;
      }
      // Check if it matches an existing suggestion
      const match = suggestions.find(
        (s) => s.Variety_Name.toLowerCase() === trimmed.toLowerCase()
      );
      if (match) {
        handleSelectExisting(match);
      } else {
        setShowDropdown(false);
        setShowConfirm(true);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setShowDropdown(false);
      setShowConfirm(false);
      setHighlightIndex(-1);
      setQuery(currentVariety ?? '');
      inputRef.current?.blur();
    }
  };

  const handleCreateAndAssign = async () => {
    const trimmed = query.trim();
    try {
      // Create new variety
      const res = await fetch(`/api/browse/${plantId}/varieties`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variety_Name: trimmed }),
      });
      if (res.ok) {
        onSelect(trimmed);
        setShowConfirm(false);
      }
    } catch {
      // error
    }
  };

  const handleClear = () => {
    setQuery('');
    onSelect(null);
    setShowDropdown(false);
    setShowConfirm(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium shrink-0">Variety:</label>
        <div className="relative flex-1">
          <Input
            ref={(el) => {
              (inputRef as any).current = el;
              if (externalInputRef) (externalInputRef as any).current = el;
            }}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim().length >= 1) fetchVarieties(query.trim()); }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Type to search or create... (v)"
            className="h-7 text-xs"
          />
          {query && (
            <button
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
              onClick={handleClear}
              title="Clear variety"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Autocomplete dropdown -- opens upward to avoid clipping */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-16 right-0 bg-popover border rounded shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((v, i) => (
            <button
              key={v.Id}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                i === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              }`}
              onMouseDown={(e) => { e.preventDefault(); handleSelectExisting(v); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="font-medium">{v.Variety_Name}</span>
              {v.Characteristics && (
                <span className="text-muted-foreground ml-2">{v.Characteristics.slice(0, 50)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Create confirmation -- opens upward, Enter confirms, Esc cancels */}
      {showConfirm && (
        <div
          className="absolute z-50 bottom-full mb-1 left-16 right-0 bg-popover border rounded shadow-lg p-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleCreateAndAssign(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowConfirm(false); inputRef.current?.focus(); }
          }}
        >
          <p className="text-xs mb-2">
            Create new variety <strong>&ldquo;{query.trim()}&rdquo;</strong>?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setShowConfirm(false); inputRef.current?.focus(); }}>
              Cancel (Esc)
            </Button>
            <Button ref={confirmRef} size="sm" className="h-6 text-xs" onClick={handleCreateAndAssign}>
              Create &amp; Assign (Enter)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Group Variety Picker (bulk set variety on group) ──────────────────────────

interface GroupVarietyPickerProps {
  plantId: string;
  imageIds: number[];
  onSet: (name: string | null) => void;
  /** Use white background for dark parent containers */
  whiteBackground?: boolean;
  /** HTML id for the input element */
  inputId?: string;
}

export function GroupVarietyPicker({ plantId, imageIds, onSet, whiteBackground, inputId }: GroupVarietyPickerProps) {
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [pendingNewName, setPendingNewName] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<BrowseVariety[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const fetchVarieties = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/browse/${plantId}/varieties-search?q=${encodeURIComponent(search)}`, { credentials: 'include' });
      if (res.ok) {
        setSuggestions(await res.json());
        setShowDropdown(true);
        setHighlightIndex(-1);
      }
    } catch {}
  }, [plantId]);

  const handleChange = (value: string) => {
    setQuery(value);
    setHighlightIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 1) {
      debounceRef.current = setTimeout(() => fetchVarieties(value.trim()), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const selectVariety = (v: BrowseVariety) => {
    setQuery('');
    setShowDropdown(false);
    onSet(v.Variety_Name);
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
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectVariety(suggestions[highlightIndex]);
      } else if (suggestions.length > 0) {
        // Suggestions available but none highlighted — select first
        selectVariety(suggestions[0]);
      } else if (query.trim()) {
        // No match — offer to create new variety
        setPendingNewName(query.trim());
        setShowCreateConfirm(true);
        setShowDropdown(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      setShowDropdown(false); setQuery('');
    }
  };

  const createVarietyAndSet = async (name: string) => {
    try {
      const res = await fetch(`/api/browse/${plantId}/varieties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variety_Name: name }),
        credentials: 'include',
      });
      if (res.ok) {
        onSet(name);
      }
    } catch {}
    setShowCreateConfirm(false);
    setPendingNewName('');
    setQuery('');
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <label className={`text-[10px] font-medium shrink-0 ${whiteBackground ? 'text-white' : 'text-muted-foreground'}`}>Variety:</label>
        <Input value={query} onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown} onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder="Variety name..."
          className="h-6 text-xs flex-1"
          id={inputId}
          style={whiteBackground ? { backgroundColor: '#ffffff', color: '#000000' } : undefined} />
      </div>
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 right-0 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((v, i) => (
            <button key={v.Id}
              className={`w-full text-left px-2 py-1 text-xs text-black transition-colors ${i === highlightIndex ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
              onMouseDown={(e) => { e.preventDefault(); selectVariety(v); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >{v.Variety_Name}</button>
          ))}
        </div>
      )}
      {showCreateConfirm && (
        <div className="absolute z-50 bottom-full mb-1 left-0 right-0 bg-white border rounded shadow-lg p-3 text-black">
          <p className="text-xs mb-2">Create variety "{pendingNewName}" and assign to {imageIds.length} image{imageIds.length !== 1 ? 's' : ''}?</p>
          <div className="flex gap-1 justify-end">
            <button className="text-xs px-2 py-1 rounded hover:bg-gray-100" onClick={() => { setShowCreateConfirm(false); setPendingNewName(''); }}>Cancel</button>
            <button className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => createVarietyAndSet(pendingNewName)}>Create & Assign</button>
          </div>
        </div>
      )}
    </div>
  );
}
