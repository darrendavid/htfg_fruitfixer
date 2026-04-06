import { useState, useRef } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VarietyPicker, type VarietySelection } from '@/components/browse/VarietyAutocomplete';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import type { VarietyMatchItem } from '@/types/matches';

interface VarietyMatchCardProps {
  item: VarietyMatchItem;
  isActive: boolean;
  isSelected?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  onAccept: (item: VarietyMatchItem, varietyId: number, varietyName: string) => Promise<void>;
  onHide: (item: VarietyMatchItem) => Promise<void>;
  onSkip: (item: VarietyMatchItem) => void;
  onClick: (e: React.MouseEvent) => void;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
};

export function VarietyMatchCard({ item, isActive, isSelected, cardRef, onAccept, onHide, onSkip, onClick }: VarietyMatchCardProps) {
  const [overrideVariety, setOverrideVariety] = useState<VarietySelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Build image URL — file_path is like "content/pass_01/assigned/avocado/images/foo.jpg"
  const imgSrc = `/images/${item.file_path
    .replace(/^content\/pass_01\/assigned\//, '')
    .replace(/^content\/parsed\//, '')
    .replace(/^assigned\//, '')
    .split('/').map(s => encodeURIComponent(s)).join('/')}`;

  const effectiveVarietyId = overrideVariety?.id ?? item.variety_id;
  const effectiveVarietyName = overrideVariety?.name ?? item.variety_name;

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    try { await onAccept(item, effectiveVarietyId, effectiveVarietyName); }
    finally { setBusy(false); }
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
      {isSelected && (
        <div className="absolute top-2 left-2 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold pointer-events-none">
          ✓
        </div>
      )}

      {/* Thumbnail */}
      <div className="shrink-0 w-[120px] h-[90px] bg-muted rounded overflow-hidden flex items-center justify-center relative group/thumb">
        <img
          ref={imgRef}
          src={imgSrc}
          alt={item.filename}
          loading="lazy"
          className="w-full h-full object-cover cursor-zoom-in"
          style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}
          onLoad={(e) => { const t = e.currentTarget; setDims({ w: t.naturalWidth, h: t.naturalHeight }); }}
          onError={() => { if (imgRef.current) imgRef.current.style.display = 'none'; }}
        />
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
      </div>

      {/* Full-size image preview */}
      <ImagePreviewDialog
        src={showPreview ? imgSrc : null}
        alt={item.filename}
        open={showPreview}
        onOpenChange={setShowPreview}
      />

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{item.filename}</p>
            <p className="text-xs text-muted-foreground">
              {dims ? `${dims.w}×${dims.h}` : '...'} · {item.plant_name}
            </p>
          </div>
          <Badge className={`shrink-0 text-[10px] ${CONFIDENCE_COLORS[item.confidence] ?? ''}`}>
            {item.confidence}
          </Badge>
        </div>

        {/* Paths */}
        {item.source_directory && (
          <p className="text-[10px] text-muted-foreground truncate select-all cursor-text" title={item.source_directory} onClick={(e) => e.stopPropagation()}>
            <span className="font-semibold text-muted-foreground/70">Source:</span> {item.source_directory}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground truncate select-all cursor-text" title={item.file_path} onClick={(e) => e.stopPropagation()}>
          <span className="font-semibold text-muted-foreground/70">Current:</span> {item.file_path}
        </p>

        {/* Match info */}
        <p className="text-xs text-muted-foreground truncate">
          <span className="font-medium">Suggested:</span>{' '}
          <span className="text-blue-600">{item.variety_name}</span>{' '}
          <span className="opacity-60">({item.match_type})</span>
        </p>
        {item.signals.length > 0 && (
          <p className="text-[10px] text-muted-foreground truncate italic">{item.signals[0]}</p>
        )}

        {/* Variety picker */}
        <div className="max-w-[200px] mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          <VarietyPicker
            plantId={item.plant_id}
            currentVariety={overrideVariety?.name ?? item.variety_name}
            onSelect={(v) => setOverrideVariety(v)}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" className="h-7 text-xs px-3 bg-green-600 hover:bg-green-700 text-white shrink-0" disabled={busy} onClick={(e) => { e.stopPropagation(); handleAccept(); }}>
            {busy ? '...' : 'Accept (a)'}
          </Button>
          <Button size="sm" variant="destructive" className="h-7 text-xs px-2 shrink-0" disabled={busy} onClick={(e) => { e.stopPropagation(); onHide(item); }}>
            Hide (h)
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2 shrink-0" onClick={(e) => { e.stopPropagation(); onSkip(item); }}>
            Skip (s)
          </Button>
        </div>
      </div>
    </div>
  );
}
