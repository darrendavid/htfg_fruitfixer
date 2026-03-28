import { useState, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import type { MatchItem, UndoToken } from '@/types/matches';

// Derive thumbnail URL from file_path
// file_path: "content/pass_01/unassigned/unclassified/images/Foo/bar.jpg"
// URL:        "/unassigned-images/unclassified/images/Foo/bar.jpg"
function thumbUrl(item: MatchItem): string {
  const prefix = 'content/pass_01/unassigned/';
  const stripped = item.file_path.startsWith(prefix)
    ? item.file_path.slice(prefix.length)
    : item.file_path;
  return `/unassigned-images/${stripped}`;
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

const CONFIDENCE_CLASSES: Record<MatchItem['confidence'], string> = {
  high: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-orange-100 text-orange-800 border-orange-300',
};

interface MatchCardProps {
  item: MatchItem;
  isActive: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  onApprove: (item: MatchItem, plant: PlantSuggestion, variety: VarietySelection | null) => Promise<UndoToken | null>;
  onReview: (item: MatchItem) => Promise<UndoToken | null>;
  onIgnore: (item: MatchItem) => Promise<UndoToken | null>;
  onClick: () => void;
}

export function MatchCard({ item, isActive, cardRef, onApprove, onReview, onIgnore, onClick }: MatchCardProps) {
  // Pre-fill plant from inference
  const [selectedPlant, setSelectedPlant] = useState<PlantSuggestion | null>({
    Id: 0,
    Id1: item.plant_id,
    Canonical_Name: item.plant_name,
  });
  const [selectedVariety, setSelectedVariety] = useState<VarietySelection | null>(
    item.variety_id != null && item.variety_name
      ? { id: item.variety_id, name: item.variety_name }
      : null
  );
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleApprove = async () => {
    if (!selectedPlant || busy) return;
    setBusy(true);
    await onApprove(item, selectedPlant, selectedVariety);
    setBusy(false);
  };

  const handleReview = async () => {
    if (busy) return;
    setBusy(true);
    await onReview(item);
    setBusy(false);
  };

  const handleIgnore = async () => {
    if (busy) return;
    setBusy(true);
    await onIgnore(item);
    setBusy(false);
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
        isActive ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted/50'
      }`}
    >
      {/* Thumbnail */}
      <div className="shrink-0 w-[150px] h-[110px] bg-muted rounded overflow-hidden flex items-center justify-center">
        <img
          ref={imgRef}
          src={thumbUrl(item)}
          alt={item.filename}
          loading="lazy"
          className="w-full h-full object-cover"
          onLoad={(e) => { const t = e.currentTarget; setDims({ w: t.naturalWidth, h: t.naturalHeight }); }}
          onError={() => { if (imgRef.current) imgRef.current.style.display = 'none'; }}
        />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{item.filename}</p>
            <p className="text-xs text-muted-foreground">{dims ? `${dims.w}×${dims.h}` : '...'} · {item.parent_dir}</p>
          </div>
          <Badge className={`text-xs shrink-0 ${CONFIDENCE_CLASSES[item.confidence]}`}>
            {item.confidence}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Match:</span> {item.match_type}
          {item.signals.length > 0 && (
            <span className="ml-2 italic">{item.signals.slice(0, 3).join(', ')}</span>
          )}
        </p>

        {/* Plant + Variety selectors */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs font-medium shrink-0">Plant:</span>
          <span className="text-xs font-semibold text-blue-600">{selectedPlant?.Canonical_Name ?? '(none)'}</span>
          <PlantAutocomplete
            label=""
            placeholder="Override..."
            onSelect={(plant) => { setSelectedPlant(plant); setSelectedVariety(null); }}
            onCreateAndSelect={(name, slug) => {
              setSelectedPlant({ Id: 0, Id1: slug, Canonical_Name: name });
              setSelectedVariety(null);
            }}
            createMessage={(name) => `Create plant "${name}"?`}
            createLabel="Create"
            resetKey={item.file_path}
            dropdownLeftClass="left-0"
            inputClassName="h-6 text-xs w-32"
          />
          {selectedVariety && (
            <span className="text-xs text-purple-600 font-medium">· {selectedVariety.name}</span>
          )}
        </div>
        {selectedPlant && (
          <VarietyPicker
            plantId={selectedPlant.Id1}
            currentVariety={selectedVariety?.name ?? null}
            onSelect={(v) => setSelectedVariety(v)}
          />
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-1">
          <Button
            size="sm"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={(e) => { e.stopPropagation(); handleApprove(); }}
            disabled={busy || !selectedPlant}
            title="Approve (a)"
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); handleReview(); }}
            disabled={busy}
            title="Send to triage (r)"
          >
            Triage
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); handleIgnore(); }}
            disabled={busy}
            title="Ignore (i)"
          >
            Ignore
          </Button>
        </div>
      </div>
    </div>
  );
}
