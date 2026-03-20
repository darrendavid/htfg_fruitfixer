import { useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LazyImage } from '@/components/images/LazyImage';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import type { BrowseOcr } from '@/types/browse';

interface KeyFact {
  field: string;
  value: string;
}

function parseKeyFacts(raw: string | null): KeyFact[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

interface OcrTabProps {
  ocrExtractions: BrowseOcr[];
  plantId: string;
  onOcrDeleted?: (id: number) => void;
}

export function OcrTab({ ocrExtractions, plantId, onOcrDeleted }: OcrTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState(ocrExtractions);
  const [viewingImage, setViewingImage] = useState<{ src: string; title: string } | null>(null);

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/browse/ocr-extractions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setItems((prev) => prev.filter((o) => o.Id !== id));
        onOcrDeleted?.(id);
      }
    } catch {}
  };

  const handleReassign = async (ocrId: number, newPlantId: string) => {
    try {
      const ocr = items.find((o) => o.Id === ocrId);
      if (!ocr) return;
      const currentIds: string[] = ocr.Plant_Ids ? JSON.parse(ocr.Plant_Ids) : [];
      const newIds = currentIds.filter((id) => id !== plantId);
      if (!newIds.includes(newPlantId)) newIds.push(newPlantId);
      const res = await fetch(`/api/browse/ocr-extractions/${ocrId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Plant_Ids: JSON.stringify(newIds) }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((o) => o.Id !== ocrId));
      }
    } catch {}
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No OCR extractions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((ocr) => {
        const keyFacts = parseKeyFacts(ocr.Key_Facts);

        return (
          <Card key={ocr.Id} className="p-4 overflow-hidden">
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm select-text break-words">{ocr.Title}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{ocr.Content_Type}</Badge>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive shrink-0"
                  onClick={() => handleDelete(ocr.Id)}
                >
                  Delete
                </Button>
              )}
            </div>

            {/* Reassign to different plant */}
            {isAdmin && (
              <div className="mb-3">
                <OcrPlantReassigner ocrId={ocr.Id} onReassign={(newPlantId) => handleReassign(ocr.Id, newPlantId)} />
              </div>
            )}

            <div className="space-y-3">
              {/* Source image — shown first so text doesn't overlap */}
              {ocr.Image_Path && (
                <div className="clear-both">
                  <h4 className="text-sm font-medium mb-1">Source Image</h4>
                  <div
                    className="cursor-pointer hover:opacity-80 transition-opacity inline-block"
                    onClick={() => setViewingImage({
                      src: `/content-files/${ocr.Image_Path.replace(/^content\//, '')}`,
                      title: ocr.Title,
                    })}
                  >
                    <img
                      src={`/content-files/${ocr.Image_Path.replace(/^content\//, '')}`}
                      alt={ocr.Title}
                      className="max-w-full max-h-48 rounded border"
                      loading="lazy"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">Click to view full size</p>
                  </div>
                </div>
              )}

              {/* Key facts table */}
              {keyFacts.length > 0 && (
                <div className="rounded border overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <tbody>
                      {keyFacts.map((fact, i) => (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="px-2 py-1 font-medium text-muted-foreground bg-muted/50 w-1/3 select-text break-words">
                            {fact.field}
                          </td>
                          <td className="px-2 py-1 select-text break-words">{fact.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Extracted text */}
              {ocr.Extracted_Text && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Extracted Text</h4>
                  <div className="max-h-60 overflow-y-auto border rounded p-2">
                    <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground select-text">
                      {ocr.Extracted_Text}
                    </p>
                  </div>
                </div>
              )}

              {ocr.Source_Context && (
                <p className="text-xs text-muted-foreground select-text break-words mt-1">Context: {ocr.Source_Context}</p>
              )}
            </div>
          </Card>
        );
      })}

      {/* Full-size image viewer dialog */}
      <Dialog open={viewingImage !== null} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2 flex flex-col overflow-hidden">
          <DialogTitle className="sr-only">{viewingImage?.title ?? 'Image'}</DialogTitle>
          {viewingImage && (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={viewingImage.src}
                alt={viewingImage.title}
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── OCR Plant Reassigner ─────────────────────────────────────────────────────

interface OcrPlantReassignerProps {
  ocrId: number;
  onReassign: (newPlantId: string) => void;
}

function OcrPlantReassigner({ ocrId, onReassign }: OcrPlantReassignerProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ Id: number; Id1: string; Canonical_Name: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [confirmCreate, setConfirmCreate] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const fetchPlants = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/browse/plants-search?q=${encodeURIComponent(search)}`, { credentials: 'include' });
      if (res.ok) {
        setSuggestions(await res.json());
        setShowDropdown(true);
        setHighlightIndex(-1);
      }
    } catch {}
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setHighlightIndex(-1);
    setConfirmCreate(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 1) {
      debounceRef.current = setTimeout(() => fetchPlants(value.trim()), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const selectPlant = (plant: { Id1: string; Canonical_Name: string }) => {
    setQuery('');
    setShowDropdown(false);
    setConfirmCreate(null);
    onReassign(plant.Id1);
  };

  const createAndAssign = async (name: string) => {
    try {
      const res = await fetch('/api/browse/create-plant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Canonical_Name: name }),
      });
      if (res.ok) {
        const plant = await res.json();
        selectPlant({ Id1: plant.Id1, Canonical_Name: plant.Canonical_Name });
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
      if (confirmCreate) {
        createAndAssign(confirmCreate);
      } else if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectPlant(suggestions[highlightIndex]);
      } else if (query.trim() && suggestions.length === 0) {
        setConfirmCreate(query.trim());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (confirmCreate) { setConfirmCreate(null); }
      else { setShowDropdown(false); setQuery(''); }
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium shrink-0 text-muted-foreground">Move to:</label>
        <Input value={query} onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown} onBlur={() => setTimeout(() => { setShowDropdown(false); }, 200)}
          placeholder="Reassign to another plant..." className="h-6 text-xs flex-1 bg-white text-black" />
      </div>
      {confirmCreate && (
        <div className="absolute z-50 bottom-full mb-1 left-16 right-0 bg-popover border rounded shadow-lg p-2">
          <p className="text-xs mb-2">Create new plant "<span className="font-bold">{confirmCreate}</span>"?</p>
          <div className="flex gap-1">
            <Button size="sm" className="h-6 text-xs" onClick={() => createAndAssign(confirmCreate)}>
              Create
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setConfirmCreate(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!confirmCreate && showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-16 right-0 bg-popover border rounded shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((p, i) => (
            <button key={p.Id}
              className={`w-full text-left px-2 py-1.5 text-xs transition-colors ${i === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
              onMouseDown={(e) => { e.preventDefault(); selectPlant(p); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >{p.Canonical_Name}</button>
          ))}
        </div>
      )}
      {!confirmCreate && showDropdown && suggestions.length === 0 && query.trim().length >= 2 && (
        <div className="absolute z-50 bottom-full mb-1 left-16 right-0 bg-popover border rounded shadow-lg p-2">
          <p className="text-xs text-muted-foreground">No matches. Press Enter to create "<span className="font-bold">{query.trim()}</span>"</p>
        </div>
      )}
    </div>
  );
}
