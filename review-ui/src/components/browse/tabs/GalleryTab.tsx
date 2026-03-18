import { useState, useEffect, useCallback, useRef } from 'react';
import { LazyImage } from '@/components/images/LazyImage';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import type { BrowseImage } from '@/types/browse';

const PAGE_SIZE = 50;

function stripParsedPrefix(filePath: string) {
  return filePath.replace(/^content\/parsed\//, '');
}

interface GalleryTabProps {
  plantId: string;
}

export function GalleryTab({ plantId }: GalleryTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [images, setImages] = useState<BrowseImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const lightboxImgRef = useRef<HTMLImageElement>(null);

  const lightboxImage = lightboxIndex !== null ? images[lightboxIndex] : null;

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

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

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

  // Handle cached images where onLoad fires before ref attaches
  useEffect(() => {
    if (lightboxIndex === null) return;
    const el = lightboxImgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setImageDimensions({ w: el.naturalWidth, h: el.naturalHeight });
    }
  }, [lightboxIndex]);

  const deleteImage = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/exclude-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setTotalRows((prev) => prev - 1);
        setImageDimensions(null);
        // Remove from array so next image slides into current index
        setImages((prev) => {
          const next = prev.filter((i) => i.Id !== img.Id);
          // Adjust lightbox index
          if (lightboxIndex !== null) {
            if (next.length === 0) {
              closeLightbox();
            } else if (lightboxIndex >= next.length) {
              // Was last image — close lightbox
              closeLightbox();
            }
            // else: stay at same index, next image is now at this position
          }
          return next;
        });
      }
    } catch {
      // error
    }
  }, [lightboxIndex, images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'x' && isAdmin && lightboxImage) {
        e.preventDefault();
        deleteImage(lightboxImage);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, goNext, goPrev, deleteImage, lightboxImage, isAdmin]);

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
                className="aspect-square bg-muted rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-ring transition-shadow relative"
                onClick={() => openLightbox(idx)}
              >
                <LazyImage
                  src={`/images/${stripParsedPrefix(img.File_Path)}`}
                  alt={img.Caption ?? ''}
                  className="w-full h-full"
                />
              </div>
              {img.Caption && (
                <p className="text-[10px] text-muted-foreground line-clamp-1">
                  {img.Caption}
                </p>
              )}
            </div>
          ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={lightboxIndex !== null} onOpenChange={(open) => { if (!open) closeLightbox(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">{lightboxImage?.Caption ?? 'Image preview'}</DialogTitle>
          {lightboxImage && (
            <div className="flex flex-col gap-2">
              {/* Image with nav arrows */}
              <div className="relative">
                {/* Left arrow */}
                {lightboxIndex !== null && lightboxIndex > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-1 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                    aria-label="Previous image"
                  >
                    &#8249;
                  </button>
                )}

                {/* Right arrow */}
                {lightboxIndex !== null && lightboxIndex < images.length - 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                    aria-label="Next image"
                  >
                    &#8250;
                  </button>
                )}

                <div className="relative">
                  <img
                    ref={lightboxImgRef}
                    src={`/images/${stripParsedPrefix(lightboxImage.File_Path)}`}
                    alt={lightboxImage.Caption ?? ''}
                    className="w-full h-auto max-h-[70vh] object-contain rounded"
                    onLoad={handleImageLoad}
                  />
                </div>
              </div>

              {/* Info bar */}
              <div className="flex items-center justify-between px-1">
                <div className="space-y-0.5 min-w-0 flex-1">
                  {lightboxImage.Caption && (
                    <p className="text-sm font-medium">{lightboxImage.Caption}</p>
                  )}
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {stripParsedPrefix(lightboxImage.File_Path)}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
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
                    {lightboxIndex !== null && (
                      <span className="text-xs text-muted-foreground">
                        {lightboxIndex + 1} / {images.length}
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteImage(lightboxImage)}
                    title="Delete image (x)"
                  >
                    Delete (x)
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
