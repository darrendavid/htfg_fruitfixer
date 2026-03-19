import { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { LazyImage } from '@/components/images/LazyImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import type { BrowseImage, BrowseVariety } from '@/types/browse';

const PAGE_SIZE = 50;

function stripParsedPrefix(filePath: string) {
  return filePath.replace(/^content\/parsed\//, '');
}

function rotationClass(deg: number | undefined | null): string {
  const d = ((deg ?? 0) % 360 + 360) % 360;
  if (d === 90) return 'rotate-90';
  if (d === 180) return 'rotate-180';
  if (d === 270) return '-rotate-90';
  return '';
}

interface GalleryTabProps {
  plantId: string;
  currentHeroPath?: string;
  onHeroChanged?: (filePath: string) => void;
}

export function GalleryTab({ plantId, currentHeroPath, onHeroChanged }: GalleryTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [images, setImages] = useState<BrowseImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [heroPath, setHeroPath] = useState<string | null>(currentHeroPath ?? null);
  const lightboxImgRef = useRef<HTMLImageElement>(null);

  const lightboxImage = lightboxIndex !== null ? images[lightboxIndex] : null;

  useEffect(() => {
    if (currentHeroPath) setHeroPath(currentHeroPath);
  }, [currentHeroPath]);

  const fetchImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/browse/${plantId}/images?page=${page}&limit=${PAGE_SIZE}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setImages(data.list ?? []);
        const total = data.pageInfo?.totalRows ?? 0;
        setTotalRows(total);
        setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
      }
    } catch {
      // Network error
    } finally {
      setIsLoading(false);
    }
  }, [plantId, page]);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setImageDimensions(null);
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
    setImageDimensions(null);
  };

  const goNext = useCallback(() => {
    if (lightboxIndex === null) return;
    if (lightboxIndex < images.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
      setImageDimensions(null);
    } else {
      closeLightbox();
    }
  }, [lightboxIndex, images.length]);

  const goPrev = useCallback(() => {
    if (lightboxIndex === null) return;
    if (lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
      setImageDimensions(null);
    }
  }, [lightboxIndex]);

  const handleImageLoad = () => {
    const el = lightboxImgRef.current;
    if (el && el.naturalWidth > 0) {
      setImageDimensions({ w: el.naturalWidth, h: el.naturalHeight });
    }
  };

  useEffect(() => {
    if (lightboxIndex === null) return;
    const el = lightboxImgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setImageDimensions({ w: el.naturalWidth, h: el.naturalHeight });
    }
  }, [lightboxIndex]);

  const setAsHero = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/set-hero/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plant_id: plantId }),
      });
      if (res.ok) {
        const stripped = stripParsedPrefix(img.File_Path);
        setHeroPath(stripped);
        onHeroChanged?.(stripped);
      }
    } catch {
      // error
    }
  }, [plantId, onHeroChanged]);

  const deleteImage = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/exclude-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setTotalRows((prev) => prev - 1);
        setImageDimensions(null);
        setImages((prev) => {
          const next = prev.filter((i) => i.Id !== img.Id);
          if (lightboxIndex !== null) {
            if (next.length === 0 || lightboxIndex >= next.length) {
              closeLightbox();
            }
          }
          return next;
        });
      }
    } catch {
      // error
    }
  }, [lightboxIndex]);

  const rotateImage = useCallback(async (img: BrowseImage, direction: 'cw' | 'ccw') => {
    const current = (img as any).Rotation ?? 0;
    const newRotation = (current + (direction === 'cw' ? 90 : -90) + 360) % 360;
    try {
      const res = await fetch(`/api/browse/rotate-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation: newRotation }),
      });
      if (res.ok) {
        setImages((prev) =>
          prev.map((i) => (i.Id === img.Id ? { ...i, Rotation: newRotation } as any : i))
        );
      }
    } catch {
      // error
    }
  }, []);

  const setImageVariety = useCallback(async (img: BrowseImage, varietyName: string | null) => {
    try {
      const res = await fetch(`/api/browse/set-image-variety/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variety_name: varietyName }),
      });
      if (res.ok) {
        setImages((prev) =>
          prev.map((i) => (i.Id === img.Id ? { ...i, Variety_Name: varietyName } as any : i))
        );
      }
    } catch {
      // error
    }
  }, []);

  // Keyboard navigation — skip when typing in an input
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'x' && isAdmin && lightboxImage) { e.preventDefault(); deleteImage(lightboxImage); }
      else if (e.key === 'h' && isAdmin && lightboxImage) { e.preventDefault(); setAsHero(lightboxImage); }
      else if (e.key === '[' && isAdmin && lightboxImage) { e.preventDefault(); rotateImage(lightboxImage, 'ccw'); }
      else if (e.key === ']' && isAdmin && lightboxImage) { e.preventDefault(); rotateImage(lightboxImage, 'cw'); }
      else if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, goNext, goPrev, deleteImage, setAsHero, rotateImage, lightboxImage, isAdmin]);

  const isHero = (img: BrowseImage) => {
    const stripped = stripParsedPrefix(img.File_Path);
    return heroPath === stripped;
  };

  const GoldStar = () => (
    <div className="absolute top-1 left-1 z-10 text-yellow-400 drop-shadow-md" title="Hero image">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5">
        <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" />
      </svg>
    </div>
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No images available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{totalRows} images total</p>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {images.map((img, idx) => (
          <div key={img.Id} className="space-y-1">
            <div
              className="group aspect-square bg-muted rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-ring transition-shadow relative"
              onClick={() => openLightbox(idx)}
            >
              <div className={`w-full h-full ${rotationClass((img as any).Rotation)}`}>
                <LazyImage
                  src={`/images/${stripParsedPrefix(img.File_Path)}`}
                  alt={img.Caption ?? ''}
                  className="w-full h-full"
                />
              </div>
              {isHero(img) && <GoldStar />}
              {/* Rotate icons on hover */}
              {isAdmin && (
                <>
                  <button
                    className="absolute bottom-1 left-1 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rotate left ([)"
                    onClick={(e) => { e.stopPropagation(); rotateImage(img, 'ccw'); }}
                  >
                    <RotateCcw className="size-4" />
                  </button>
                  <button
                    className="absolute bottom-1 right-1 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rotate right (])"
                    onClick={(e) => { e.stopPropagation(); rotateImage(img, 'cw'); }}
                  >
                    <RotateCw className="size-4" />
                  </button>
                </>
              )}
            </div>
            {((img as any).Variety_Name || img.Caption) && (
              <p className="text-[10px] text-muted-foreground line-clamp-1">
                {(img as any).Variety_Name && (
                  <span className="text-blue-500 font-medium">{(img as any).Variety_Name} </span>
                )}
                {img.Caption}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={lightboxIndex !== null} onOpenChange={(open) => { if (!open) closeLightbox(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2 flex flex-col overflow-hidden" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">{lightboxImage?.Caption ?? 'Image preview'}</DialogTitle>
          {lightboxImage && (
            <div className="flex flex-col gap-2 min-h-0">
              <div className="relative flex-1 min-h-0">
                {/* Left arrow */}
                {lightboxIndex !== null && lightboxIndex > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-1 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                  >&#8249;</button>
                )}
                {/* Right arrow */}
                {lightboxIndex !== null && lightboxIndex < images.length - 1 && (
                  <button onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                  >&#8250;</button>
                )}

                <div className="relative h-full flex items-center justify-center">
                  <img
                    ref={lightboxImgRef}
                    src={`/images/${stripParsedPrefix(lightboxImage.File_Path)}`}
                    alt={lightboxImage.Caption ?? ''}
                    className={`max-w-full max-h-[55vh] object-contain rounded ${rotationClass((lightboxImage as any).Rotation)}`}
                    onLoad={handleImageLoad}
                  />
                  {isHero(lightboxImage) && <GoldStar />}
                </div>
              </div>

              {/* Info section — stacked rows */}
              <div className="space-y-2 px-1">
                {/* Row 1: file info */}
                <div>
                  {lightboxImage.Caption && (
                    <p className="text-sm font-medium">{lightboxImage.Caption}</p>
                  )}
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {stripParsedPrefix(lightboxImage.File_Path)}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {imageDimensions && (
                      <Badge variant="outline" className="text-xs">
                        {imageDimensions.w} x {imageDimensions.h} px
                      </Badge>
                    )}
                    {lightboxImage.Size_Bytes > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {(lightboxImage.Size_Bytes / 1024).toFixed(0)} KB
                      </Badge>
                    )}
                    {(lightboxImage as any).Rotation > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {(lightboxImage as any).Rotation}°
                      </Badge>
                    )}
                    {lightboxIndex !== null && (
                      <span className="text-xs text-muted-foreground">
                        {lightboxIndex + 1} / {images.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: plant reassign + variety picker */}
                {isAdmin && lightboxImage && (
                  <div className="space-y-1">
                    <PlantReassigner
                      currentPlantId={plantId}
                      imageId={lightboxImage.Id}
                      onReassigned={() => {
                        // Remove from current gallery and advance
                        setImages((prev) => {
                          const next = prev.filter((i) => i.Id !== lightboxImage.Id);
                          if (next.length === 0 || (lightboxIndex !== null && lightboxIndex >= next.length)) {
                            closeLightbox();
                          }
                          return next;
                        });
                        setTotalRows((prev) => prev - 1);
                      }}
                    />
                    <VarietyPicker
                      plantId={plantId}
                      currentVariety={(lightboxImage as any).Variety_Name ?? null}
                      onSelect={(name) => setImageVariety(lightboxImage, name)}
                    />
                  </div>
                )}

                {/* Row 3: action buttons */}
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => rotateImage(lightboxImage, 'ccw')}
                      title="Rotate left ([)"
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => rotateImage(lightboxImage, 'cw')}
                      title="Rotate right (])"
                    >
                      <RotateCw className="size-4" />
                    </Button>
                    <Button
                      variant={isHero(lightboxImage) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setAsHero(lightboxImage)}
                      title="Set as hero image (h)"
                      className={isHero(lightboxImage) ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : ''}
                    >
                      {isHero(lightboxImage) ? '★ Hero' : 'Hero (h)'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteImage(lightboxImage)}
                      title="Delete image (x)"
                    >
                      Delete (x)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Variety Picker (autocomplete with create-new) ────────────────────────────

interface VarietyPickerProps {
  plantId: string;
  currentVariety: string | null;
  onSelect: (name: string | null) => void;
}

function VarietyPicker({ plantId, currentVariety, onSelect }: VarietyPickerProps) {
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
    // Arrow keys for autocomplete navigation — works if suggestions exist
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
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim().length >= 1) fetchVarieties(query.trim()); }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Type to search or create..."
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

      {/* Autocomplete dropdown — opens upward to avoid clipping */}
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

      {/* Create confirmation — opens upward, Enter confirms, Esc cancels */}
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

// ── Plant Reassigner (autocomplete to move image to another plant) ────────────

interface PlantReassignerProps {
  currentPlantId: string;
  imageId: number;
  onReassigned: () => void;
}

function PlantReassigner({ currentPlantId, imageId, onReassigned }: PlantReassignerProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ Id: number; Id1: string; Canonical_Name: string; Category: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showConfirm, setShowConfirm] = useState<{ id: string; name: string } | null>(null);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setQuery('');
    setShowDropdown(false);
    setShowConfirm(null);
    setShowCreateConfirm(false);
    setHighlightIndex(-1);
  }, [imageId]);

  useEffect(() => {
    if (showConfirm) confirmRef.current?.focus();
    if (showCreateConfirm) createRef.current?.focus();
  }, [showConfirm, showCreateConfirm]);

  const fetchPlants = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/browse/plants-search?q=${encodeURIComponent(search)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Exclude current plant
        const filtered = data.filter((p: any) => p.Id1 !== currentPlantId);
        setSuggestions(filtered);
        setShowDropdown(filtered.length > 0);
        setHighlightIndex(-1);
      }
    } catch {}
  }, [currentPlantId]);

  const handleChange = (value: string) => {
    setQuery(value);
    setShowConfirm(null);
    setHighlightIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 1) {
      debounceRef.current = setTimeout(() => fetchPlants(value.trim()), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const selectPlant = (plant: { Id1: string; Canonical_Name: string }) => {
    setQuery(plant.Canonical_Name);
    setShowDropdown(false);
    setHighlightIndex(-1);
    setShowConfirm({ id: plant.Id1, name: plant.Canonical_Name });
  };

  const handleReassign = async () => {
    if (!showConfirm) return;
    try {
      const res = await fetch(`/api/browse/reassign-image/${imageId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plant_id: showConfirm.id }),
      });
      if (res.ok) {
        setShowConfirm(null);
        setQuery('');
        onReassigned();
      }
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault();
        e.stopPropagation();
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
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectPlant(suggestions[highlightIndex]);
      } else {
        const trimmed = query.trim();
        if (!trimmed) return;
        // Check exact match
        const match = suggestions.find(
          (s) => s.Canonical_Name.toLowerCase() === trimmed.toLowerCase()
        );
        if (match) {
          selectPlant(match);
        } else {
          // No match — offer to create
          setShowDropdown(false);
          setShowCreateConfirm(true);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setShowDropdown(false);
      setShowConfirm(null);
      setShowCreateConfirm(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  const handleCreateAndReassign = async () => {
    const trimmed = query.trim();
    const newSlug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const res = await fetch('/api/browse/create-plant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Canonical_Name: trimmed, Id1: newSlug, Category: 'fruit' }),
      });
      if (res.ok) {
        // Now reassign the image
        const reassignRes = await fetch(`/api/browse/reassign-image/${imageId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plant_id: newSlug }),
        });
        if (reassignRes.ok) {
          setShowCreateConfirm(false);
          setQuery('');
          onReassigned();
        }
      }
    } catch {}
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium shrink-0">Plant:</label>
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim().length >= 1) fetchPlants(query.trim()); }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Reassign to another plant..."
            className="h-7 text-xs"
          />
        </div>
      </div>

      {/* Autocomplete dropdown — opens upward */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-12 right-0 bg-popover border rounded shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((p, i) => (
            <button
              key={p.Id}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                i === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              }`}
              onMouseDown={(e) => { e.preventDefault(); selectPlant(p); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="font-medium">{p.Canonical_Name}</span>
              <span className="text-muted-foreground ml-2">{p.Category}</span>
            </button>
          ))}
        </div>
      )}

      {/* Reassign confirmation — opens upward */}
      {showConfirm && (
        <div
          className="absolute z-50 bottom-full mb-1 left-12 right-0 bg-popover border rounded shadow-lg p-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleReassign(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowConfirm(null); inputRef.current?.focus(); }
          }}
        >
          <p className="text-xs mb-2">
            Move this image to <strong>{showConfirm.name}</strong>?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setShowConfirm(null); inputRef.current?.focus(); }}>
              Cancel (Esc)
            </Button>
            <Button ref={confirmRef} size="sm" className="h-6 text-xs" onClick={handleReassign}>
              Move (Enter)
            </Button>
          </div>
        </div>
      )}

      {/* Create new plant confirmation — opens upward */}
      {showCreateConfirm && (
        <div
          className="absolute z-50 bottom-full mb-1 left-12 right-0 bg-popover border rounded shadow-lg p-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleCreateAndReassign(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowCreateConfirm(false); inputRef.current?.focus(); }
          }}
        >
          <p className="text-xs mb-2">
            Plant <strong>&ldquo;{query.trim()}&rdquo;</strong> doesn&apos;t exist. Create it and move this image?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { setShowCreateConfirm(false); inputRef.current?.focus(); }}>
              Cancel (Esc)
            </Button>
            <Button ref={createRef} size="sm" className="h-6 text-xs" onClick={handleCreateAndReassign}>
              Create &amp; Move (Enter)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
