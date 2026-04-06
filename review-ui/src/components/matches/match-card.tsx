import { useState, useRef } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import type { MatchItem, UndoToken } from '@/types/matches';

// Derive thumbnail URL from file_path (images only)
function thumbUrl(item: MatchItem): string {
  const prefix = 'content/pass_01/unassigned/';
  const stripped = item.file_path.startsWith(prefix)
    ? item.file_path.slice(prefix.length)
    : item.file_path;
  // Encode each path segment to handle # and other special chars in directory names
  const encoded = stripped.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `/unassigned-images/${encoded}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const CONFIDENCE_CLASSES: Record<string, string> = {
  high: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-orange-100 text-orange-800 border-orange-300',
};

const EXT_COLORS: Record<string, string> = {
  pdf: 'bg-red-100 text-red-700',
  doc: 'bg-blue-100 text-blue-700',
  docx: 'bg-blue-100 text-blue-700',
  ppt: 'bg-orange-100 text-orange-700',
  pptx: 'bg-orange-100 text-orange-700',
  xls: 'bg-green-100 text-green-700',
  xlsx: 'bg-green-100 text-green-700',
  txt: 'bg-gray-100 text-gray-700',
};

function fileExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

interface MatchCardProps {
  item: MatchItem;
  isActive: boolean;
  isSelected?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  onApprove: (item: MatchItem, plant: PlantSuggestion, variety: VarietySelection | null) => Promise<UndoToken | null>;
  onAttach: (item: MatchItem, plant: PlantSuggestion) => Promise<UndoToken | null>;
  onReview: (item: MatchItem) => Promise<UndoToken | null>;
  onIgnore: (item: MatchItem) => Promise<UndoToken | null>;
  onClick: (e: React.MouseEvent) => void;
}

export function MatchCard({ item, isActive, isSelected, cardRef, onApprove, onAttach, onReview, onIgnore, onClick }: MatchCardProps) {
  const [selectedPlant, setSelectedPlant] = useState<PlantSuggestion | null>(
    item.plant_id && item.plant_name
      ? { Id: 0, Id1: item.plant_id, Canonical_Name: item.plant_name }
      : null
  );
  const [selectedVariety, setSelectedVariety] = useState<VarietySelection | null>(
    item.variety_id != null && item.variety_name
      ? { id: item.variety_id, name: item.variety_name }
      : null
  );
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const isDoc = item.file_type === 'document';
  const ext = fileExt(item.filename);

  const handleApprove = async () => {
    if (!selectedPlant || busy) return;
    setBusy(true);
    await onApprove(item, selectedPlant, selectedVariety);
    setBusy(false);
  };

  const handleAttach = async () => {
    if (!selectedPlant || busy) return;
    setBusy(true);
    await onAttach(item, selectedPlant);
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
      className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors relative ${
        isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400 ring-offset-1' :
        isActive ? 'border-blue-400 bg-blue-50/60' : 'border-border hover:bg-muted/50'
      }`}
    >
      {/* Selection checkmark */}
      {isSelected && (
        <div className="absolute top-2 left-2 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold pointer-events-none">
          ✓
        </div>
      )}

      {/* Thumbnail / File icon */}
      <div className="shrink-0 w-[150px] h-[110px] bg-muted rounded overflow-hidden flex items-center justify-center relative group/thumb">
        {isDoc ? (
          <div className="flex flex-col items-center gap-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${EXT_COLORS[ext] ?? 'bg-gray-100 text-gray-600'}`}>
              {ext || 'file'}
            </span>
            <span className="text-xs text-muted-foreground text-center px-2 leading-tight max-h-16 overflow-hidden">
              {formatSize(item.file_size)}
            </span>
          </div>
        ) : (
          <>
            <img
              ref={imgRef}
              src={thumbUrl(item)}
              alt={item.filename}
              loading="lazy"
              className="w-full h-full object-cover cursor-zoom-in"
              style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
              onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}
              onLoad={(e) => { const t = e.currentTarget; setDims({ w: t.naturalWidth, h: t.naturalHeight }); }}
              onError={() => { if (imgRef.current) imgRef.current.style.display = 'none'; }}
            />
            {/* Rotate buttons */}
            <button
              className="absolute bottom-0.5 left-0.5 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
              title="Rotate left"
              onClick={(e) => { e.stopPropagation(); setRotation((r) => (r - 90 + 360) % 360); }}
            ><RotateCcw className="size-3.5" /></button>
            <button
              className="absolute bottom-0.5 right-0.5 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
              title="Rotate right"
              onClick={(e) => { e.stopPropagation(); setRotation((r) => (r + 90) % 360); }}
            ><RotateCw className="size-3.5" /></button>
          </>
        )}
      </div>

      {/* Full-size image preview */}
      {!isDoc && (
        <ImagePreviewDialog
          src={showPreview ? thumbUrl(item) : null}
          alt={item.filename}
          open={showPreview}
          onOpenChange={setShowPreview}
        />
      )}

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{item.filename}</p>
            <p className="text-xs text-muted-foreground">
              {isDoc ? formatSize(item.file_size) : (dims ? `${dims.w}×${dims.h}` : '...')}
              {' · '}{item.parent_dir}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isDoc && (
              <Badge variant="outline" className="text-xs text-purple-700 border-purple-300">
                attachment
              </Badge>
            )}
            {item.confidence && (
              <Badge className={`text-xs ${CONFIDENCE_CLASSES[item.confidence] ?? 'bg-gray-100 text-gray-600'}`}>
                {item.confidence}
              </Badge>
            )}
          </div>
        </div>

        {/* TXT preview */}
        {item.txt_preview && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-1.5 leading-relaxed max-h-16 overflow-hidden whitespace-pre-wrap">
            {item.txt_preview}
          </p>
        )}

        {item.match_type && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Match:</span> {item.match_type}
            {item.signals.length > 0 && (
              <span className="ml-2 italic">{item.signals.slice(0, 3).join(', ')}</span>
            )}
          </p>
        )}

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
        {!isDoc && (
          <div className={selectedPlant ? undefined : 'opacity-40 pointer-events-none'}>
            <VarietyPicker
              plantId={selectedPlant?.Id1 ?? ''}
              currentVariety={selectedVariety?.name ?? null}
              onSelect={(v) => setSelectedVariety(v)}
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-1 flex-wrap">
          {isDoc ? (
            <>
              <a
                href={`/content-files/${item.file_path.replace(/^content\//, '').split('/').map(s => encodeURIComponent(s)).join('/')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 text-xs inline-flex items-center px-3 rounded border border-border hover:bg-muted transition-colors"
                onClick={(e) => e.stopPropagation()}
                title="Open file in new tab"
              >
                Open
              </a>
              <Button
                size="sm"
                className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                onClick={(e) => { e.stopPropagation(); handleAttach(); }}
                disabled={busy || !selectedPlant}
                title="Attach to plant (a)"
              >
                Attach
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={(e) => { e.stopPropagation(); handleApprove(); }}
              disabled={busy || !selectedPlant}
              title="Approve (a)"
            >
              Approve
            </Button>
          )}
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
