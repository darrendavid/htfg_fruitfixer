import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { LazyImage } from '@/components/images/LazyImage';
import { buildImageUrl, rotationStyle } from '@/lib/gallery-utils';
import { toast } from 'sonner';
import type { BrowseVariety } from '@/types/browse';

interface VarietyImage {
  Id: number;
  File_Path: string;
  Caption?: string | null;
  Rotation?: number | null;
}

interface VarietyDetailDialogProps {
  variety: BrowseVariety | null;
  open: boolean;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onVarietyUpdated: (variety: BrowseVariety) => void;
}

// List of editable fields (all strings)
const EDITABLE_FIELDS: Array<keyof BrowseVariety> = [
  'Variety_Name',
  'Alternative_Names',
  'Description',
  'Genome_Group',
  'Characteristics',
  'Tasting_Notes',
  'Source',
];

const FIELD_LABELS: Record<string, string> = {
  Variety_Name: 'Name',
  Alternative_Names: 'Alternative Names',
  Description: 'Description',
  Genome_Group: 'Genome Group',
  Characteristics: 'Characteristics',
  Tasting_Notes: 'Tasting Notes',
  Source: 'Source',
};

const MULTILINE_FIELDS = new Set(['Description', 'Characteristics', 'Tasting_Notes']);

export function VarietyDetailDialog({ variety, open, canEdit, onOpenChange, onVarietyUpdated }: VarietyDetailDialogProps) {
  const [images, setImages] = useState<VarietyImage[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<BrowseVariety>>({});
  const [saving, setSaving] = useState(false);

  // Load images when dialog opens with a variety
  useEffect(() => {
    if (!variety || !open) return;
    setSlideIdx(0);
    fetch(`/api/browse/varieties/${variety.Id}/images`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { images: [] })
      .then((data) => setImages(data.images ?? []))
      .catch(() => setImages([]));
  }, [variety?.Id, open]);

  // Reset edit mode / formData when variety changes
  useEffect(() => {
    setEditMode(false);
    if (variety) {
      setFormData({
        Variety_Name: variety.Variety_Name,
        Alternative_Names: variety.Alternative_Names ?? '',
        Description: variety.Description ?? '',
        Genome_Group: variety.Genome_Group ?? '',
        Characteristics: variety.Characteristics ?? '',
        Tasting_Notes: variety.Tasting_Notes ?? '',
        Source: variety.Source ?? '',
      });
    }
  }, [variety?.Id]);

  const handleSave = useCallback(async () => {
    if (!variety) return;
    setSaving(true);
    try {
      // Normalize empty strings to null
      const payload: Record<string, any> = {};
      for (const field of EDITABLE_FIELDS) {
        const v = (formData[field] as string | undefined)?.trim();
        payload[field] = v ? v : null;
      }
      // Variety_Name must not be null
      if (!payload.Variety_Name) {
        toast.error('Variety name is required');
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/browse/varieties/${variety.Id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('update failed');
      const updated = await res.json();
      onVarietyUpdated({ ...variety, ...updated });
      setEditMode(false);
      toast.success('Variety saved');
    } catch {
      toast.error('Failed to save variety');
    } finally {
      setSaving(false);
    }
  }, [variety, formData, onVarietyUpdated]);

  // Keyboard navigation for slider
  useEffect(() => {
    if (!open || editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (images.length === 0) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSlideIdx((i) => (i - 1 + images.length) % images.length);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSlideIdx((i) => (i + 1) % images.length);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, editMode, images.length]);

  if (!variety) return null;

  const currentImage = images[slideIdx];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto [&>button[data-slot=dialog-close]]:bg-white [&>button[data-slot=dialog-close]]:text-black [&>button[data-slot=dialog-close]]:rounded-full [&>button[data-slot=dialog-close]]:size-7 [&>button[data-slot=dialog-close]]:flex [&>button[data-slot=dialog-close]]:items-center [&>button[data-slot=dialog-close]]:justify-center [&>button[data-slot=dialog-close]]:opacity-100 [&>button[data-slot=dialog-close]]:shadow-md [&>button[data-slot=dialog-close]]:ring-1 [&>button[data-slot=dialog-close]]:ring-black/20">
        <DialogTitle className="text-2xl font-bold">
          {editMode ? 'Edit Variety' : variety.Variety_Name}
        </DialogTitle>

        {/* Photo slider */}
        {images.length > 0 && (
          <div className="relative w-full bg-black rounded-lg overflow-hidden h-[50vh]" data-testid="variety-photo-slider">
            {currentImage && (
              <img
                key={currentImage.Id}
                src={buildImageUrl(currentImage.File_Path)}
                alt={currentImage.Caption ?? variety.Variety_Name}
                className="absolute inset-0 w-full h-full object-contain"
                style={rotationStyle(currentImage.Rotation ?? 0)}
              />
            )}
            {images.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/80 transition-colors z-10"
                  onClick={() => setSlideIdx((i) => (i - 1 + images.length) % images.length)}
                  aria-label="Previous image"
                >&larr;</button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/80 transition-colors z-10"
                  onClick={() => setSlideIdx((i) => (i + 1) % images.length)}
                  aria-label="Next image"
                >&rarr;</button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded z-10">
                  {slideIdx + 1} / {images.length}
                </div>
              </>
            )}
          </div>
        )}
        {images.length === 0 && (
          <div className="w-full h-[30vh] bg-black rounded-lg flex items-center justify-center text-sm text-muted-foreground">
            No photos
          </div>
        )}

        {/* Edit toggle */}
        {canEdit && (
          <div className="flex items-center gap-2">
            {!editMode ? (
              <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>Edit</Button>
            ) : (
              <>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditMode(false)} disabled={saving}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}

        {/* Fields */}
        {!editMode && (
          <div className="space-y-3 text-sm">
            {EDITABLE_FIELDS.filter(f => f !== 'Variety_Name').map((field) => {
              const value = variety[field];
              if (!value) return null;
              return (
                <div key={field}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                    {FIELD_LABELS[field]}
                  </p>
                  <p className={MULTILINE_FIELDS.has(field) ? 'whitespace-pre-wrap' : ''}>
                    {value as string}
                  </p>
                </div>
              );
            })}
            {EDITABLE_FIELDS.slice(1).every(f => !variety[f]) && (
              <p className="text-muted-foreground italic">No additional metadata.</p>
            )}
          </div>
        )}

        {editMode && (
          <div className="space-y-3">
            {EDITABLE_FIELDS.map((field) => (
              <div key={field}>
                <Label htmlFor={`variety-${field}`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {FIELD_LABELS[field]}
                </Label>
                {MULTILINE_FIELDS.has(field) ? (
                  <Textarea
                    id={`variety-${field}`}
                    value={(formData[field] as string) ?? ''}
                    onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
                    rows={3}
                    className="mt-1"
                  />
                ) : (
                  <Input
                    id={`variety-${field}`}
                    value={(formData[field] as string) ?? ''}
                    onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="mt-1"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
