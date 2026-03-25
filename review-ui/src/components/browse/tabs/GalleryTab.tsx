import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { RotateCcw, RotateCw, LayoutGrid, FolderOpen, Tags, Copy, Trash2, Upload } from 'lucide-react';
import { LazyImage } from '@/components/images/LazyImage';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { hammingDistance, stripParsedPrefix, toRelativeImagePath, buildImageUrl, rotationStyle, rotationClass } from '@/lib/gallery-utils';
import { PlantAutocomplete } from '@/components/browse/PlantAutocomplete';
import { VarietyPicker, GroupVarietyPicker } from '@/components/browse/VarietyAutocomplete';
import { useThumbSize } from '@/hooks/use-thumb-size';
import { ThumbSizeToggle } from '@/components/ui/thumb-size-toggle';
import type { BrowseImage } from '@/types/browse';

const GALLERY_GRID_CLASSES = {
  lg: 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2',
  md: 'grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-8 gap-2',
  sm: 'grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-12 gap-2',
} as const;

const PAGE_SIZE = 50;

/** Inline editable caption — click to edit, Enter to save, Esc to cancel */
function EditableCaption({ imageId, caption, onSaved }: { imageId: number; caption: string; onSaved: (c: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(caption);

  // Sync value when caption prop changes (e.g. navigating between images)
  useEffect(() => { setValue(caption); }, [caption]);

  const save = async () => {
    const trimmed = value.trim();
    try {
      const res = await fetch(`/api/browse/update-image-caption/${imageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ caption: trimmed }),
      });
      if (res.ok) onSaved(trimmed);
    } catch { /* error */ }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setValue(caption); setEditing(false); }
        }}
        onBlur={save}
        className="text-sm font-medium w-full border-b border-blue-400 outline-none bg-transparent"
        autoFocus
      />
    );
  }

  return (
    <p
      className="text-sm font-medium cursor-pointer hover:text-blue-600 transition-colors"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit caption"
    >
      {caption || <span className="text-muted-foreground italic">Add caption...</span>}
    </p>
  );
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
  const [viewMode, setViewMode] = useState<'grid' | 'grouped' | 'variety' | 'similarity'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [dimMap, setDimMap] = useState<Record<number, string>>({});
  const [showDeleted, setShowDeleted] = useState(false);
  const [filenameFilter, setFilenameFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'default' | 'newest' | 'oldest'>('default');
  const [visibleGroupCount, setVisibleGroupCount] = useState(20);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadVariety, setUploadVariety] = useState('');
  const [thumbSize, setThumbSize] = useThumbSize();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const lightboxImgRef = useRef<HTMLImageElement>(null);
  const plantInputRef = useRef<HTMLInputElement>(null);
  const varietyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentHeroPath) setHeroPath(currentHeroPath);
  }, [currentHeroPath]);

  // Reset visible group count when view mode changes
  useEffect(() => {
    setVisibleGroupCount(20);
  }, [viewMode]);

  // Infinite scroll — load more groups as user scrolls down
  useEffect(() => {
    if (viewMode === 'grid') return;
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleGroupCount((prev) => prev + 20);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, isLoading]);

  const fetchImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const useAll = viewMode !== 'grid';
      const deletedParam = showDeleted ? '&showDeleted=true' : '';
      const url = useAll
        ? `/api/browse/${plantId}/images?all=true${deletedParam}`
        : `/api/browse/${plantId}/images?page=${page}&limit=${PAGE_SIZE}${deletedParam}`;
      const res = await fetch(url, { credentials: 'include' });
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
  }, [plantId, page, viewMode, showDeleted]);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  // Refs to hold current display state — avoids TDZ issues with memos defined later
  const displayImagesLenRef = useRef(0);
  const displayImagesRef = useRef<BrowseImage[]>([]);

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
    if (lightboxIndex < displayImagesLenRef.current - 1) {
      setLightboxIndex(lightboxIndex + 1);
      setImageDimensions(null);
    } else {
      closeLightbox();
    }
  }, [lightboxIndex]);

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

  const deletingRef = useRef(false);
  const deleteImage = useCallback(async (img: BrowseImage) => {
    if (deletingRef.current) return; // Prevent rapid-fire deletes
    deletingRef.current = true;
    try {
      const res = await fetch(`/api/browse/exclude-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setTotalRows((prev) => prev - 1);
        setImageDimensions(null);
        setImages((prev) => prev.filter((i) => i.Id !== img.Id));
        // Adjust lightbox index — display will shrink by 1
        if (lightboxIndex !== null) {
          const newLen = displayImagesLenRef.current - 1;
          if (newLen === 0 || lightboxIndex >= newLen) {
            closeLightbox();
          }
        }
      }
    } catch {
      // error
    } finally {
      setTimeout(() => { deletingRef.current = false; }, 300);
    }
  }, [lightboxIndex]);

  const moveToDocuments = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/image-to-attachment/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: img.Caption }),
      });
      if (res.ok) {
        setTotalRows((prev) => prev - 1);
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
    } catch {}
  }, [lightboxIndex]);

  const unassignImage = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/unassign-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setTotalRows((prev) => prev - 1);
        setImages((prev) => prev.filter((i) => i.Id !== img.Id));
        if (lightboxIndex !== null) {
          const newLen = displayImagesLenRef.current - 1;
          if (newLen === 0 || lightboxIndex >= newLen) closeLightbox();
        }
      }
    } catch { /* error */ }
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
      const currentImage = displayImagesRef.current[lightboxIndex!];
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'x' && isAdmin && currentImage) { e.preventDefault(); deleteImage(currentImage); }
      else if (e.key === 'h' && isAdmin && currentImage) { e.preventDefault(); setAsHero(currentImage); }
      else if (e.key === '[' && isAdmin && currentImage) { e.preventDefault(); rotateImage(currentImage, 'ccw'); }
      else if (e.key === ']' && isAdmin && currentImage) { e.preventDefault(); rotateImage(currentImage, 'cw'); }
      else if (e.key === 'u' && isAdmin && currentImage) { e.preventDefault(); unassignImage(currentImage); }
      else if (e.key === 'a' && isAdmin && currentImage) { e.preventDefault(); moveToDocuments(currentImage); }
      else if (e.key === 'v' && isAdmin) { e.preventDefault(); varietyInputRef.current?.focus(); }
      else if (e.key === 'p' && isAdmin) { e.preventDefault(); plantInputRef.current?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, goNext, goPrev, deleteImage, unassignImage, setAsHero, rotateImage, moveToDocuments, isAdmin]);

  const isHero = (img: BrowseImage) => {
    const stripped = stripParsedPrefix(img.File_Path);
    return heroPath === stripped;
  };

  // Grouped view data — must be before any early returns (Rules of Hooks)
  // Filter and sort images
  const filteredImages = useMemo(() => {
    let result = images;
    if (filenameFilter) {
      const q = filenameFilter.toLowerCase();
      result = result.filter(img => {
        const filename = img.File_Path.split('/').pop()?.toLowerCase() ?? '';
        const caption = (img.Caption ?? '').toLowerCase();
        return filename.includes(q) || caption.includes(q);
      });
    }
    if (sortOrder === 'newest') {
      result = [...result].sort((a, b) => (b as any).CreatedAt?.localeCompare((a as any).CreatedAt ?? '') ?? 0);
    } else if (sortOrder === 'oldest') {
      result = [...result].sort((a, b) => (a as any).CreatedAt?.localeCompare((b as any).CreatedAt ?? '') ?? 0);
    }
    return result;
  }, [images, filenameFilter, sortOrder]);

  const groupedImages = useMemo(() => {
    if (viewMode === 'grid') return [];

    if (viewMode === 'grouped') {
      const groups: Record<string, BrowseImage[]> = {};
      for (const img of filteredImages) {
        const path = stripParsedPrefix(img.File_Path);
        const dir = path.substring(0, path.lastIndexOf('/'));
        const label = dir.includes('images/') ? dir.substring(dir.indexOf('images/') + 7) : dir;
        if (!groups[label]) groups[label] = [];
        groups[label].push(img);
      }
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }

    if (viewMode === 'variety') {
      const groups: Record<string, BrowseImage[]> = {};
      for (const img of filteredImages) {
        const variety = (img as any).Variety_Name || '(unassigned)';
        if (!groups[variety]) groups[variety] = [];
        groups[variety].push(img);
      }
      // Put unassigned last
      return Object.entries(groups).sort((a, b) => {
        if (a[0] === '(unassigned)') return 1;
        if (b[0] === '(unassigned)') return -1;
        return a[0].localeCompare(b[0]);
      });
    }

    if (viewMode === 'similarity') {
      // Group by perceptual hash similarity (Hamming distance ≤ 8)
      // Fall back to filename stem if no hashes available
      const hasHashes = images.some((i: any) => i.Perceptual_Hash);

      if (hasHashes) {
        // Union-Find for grouping similar hashes
        const parent: Record<number, number> = {};
        const find = (x: number): number => { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; };
        const union = (a: number, b: number) => { parent[find(a)] = find(b); };
        images.forEach((img) => { parent[img.Id] = img.Id; });

        // Compare all pairs with hashes — O(n²) but fine for <1000 images
        const hashed = images.filter((i: any) => i.Perceptual_Hash);
        for (let i = 0; i < hashed.length; i++) {
          for (let j = i + 1; j < hashed.length; j++) {
            const h1 = (hashed[i] as any).Perceptual_Hash as string;
            const h2 = (hashed[j] as any).Perceptual_Hash as string;
            if (h1 && h2 && hammingDistance(h1, h2) <= 8) {
              union(hashed[i].Id, hashed[j].Id);
            }
          }
        }

        const clusters: Record<number, BrowseImage[]> = {};
        for (const img of filteredImages) {
          const root = find(img.Id);
          if (!clusters[root]) clusters[root] = [];
          clusters[root].push(img);
        }

        const result: Array<[string, BrowseImage[]]> = [];
        for (const imgs of Object.values(clusters)) {
          const label = imgs[0].Caption || imgs[0].File_Path.split('/').pop()?.replace(/\.\w+$/, '') || 'similar';
          result.push([label + (imgs.length >= 2 ? ` (${imgs.length})` : ''), imgs]);
        }
        // Sort by first image's position in the flat array for visual stability
        result.sort((a, b) => {
          const aIdx = images.indexOf(a[1][0]);
          const bIdx = images.indexOf(b[1][0]);
          return aIdx - bIdx;
        });
        return result;
      }

      // Fallback: group by filename stem
      const groups: Record<string, BrowseImage[]> = {};
      for (const img of filteredImages) {
        const filename = img.File_Path.split('/').pop() || '';
        const stem = filename.replace(/\.\w+$/, '').toLowerCase()
          .replace(/[\s_-]+/g, ' ').replace(/\bcopy\b/g, '').replace(/\d+$/, '').trim();
        const key = stem || filename;
        if (!groups[key]) groups[key] = [];
        groups[key].push(img);
      }
      const result: Array<[string, BrowseImage[]]> = [];
      for (const [key, imgs] of Object.entries(groups)) {
        result.push([key + (imgs.length >= 2 ? ` (${imgs.length})` : ''), imgs]);
      }
      // Sort by first image's position for visual stability
      result.sort((a, b) => {
        const aIdx = images.indexOf(a[1][0]);
        const bIdx = images.indexOf(b[1][0]);
        return aIdx - bIdx;
      });
      return result;
    }

    return [];
  }, [filteredImages, viewMode]);

  // Display order: in grouped modes, flatten groupedImages to get visual order
  const displayImages = useMemo(() => {
    if (viewMode === 'grid') return filteredImages;
    return groupedImages.flatMap(([, imgs]) => imgs);
  }, [viewMode, filteredImages, groupedImages]);

  // Keep refs in sync for callbacks that can't access the memo directly
  displayImagesLenRef.current = displayImages.length;
  displayImagesRef.current = displayImages;

  const lightboxImage = lightboxIndex !== null ? displayImages[lightboxIndex] : null;

  // Selection handlers
  const handleImageClick = useCallback((e: React.MouseEvent, imgId: number, flatIdx: number) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      // Range select — use displayImages for correct visual order
      const start = Math.min(lastClickedIdx, flatIdx);
      const end = Math.max(lastClickedIdx, flatIdx);
      const rangeIds = displayImages.slice(start, end + 1).map((i) => i.Id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((id) => next.add(id));
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle individual — only update lastClickedIdx on select, not deselect
      const isDeselect = selectedIds.has(imgId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(imgId)) next.delete(imgId);
        else next.add(imgId);
        return next;
      });
      if (!isDeselect) setLastClickedIdx(flatIdx);
    } else {
      // Normal click — open lightbox (no selection)
      openLightbox(flatIdx);
      return;
    }
    // Don't open lightbox on shift/ctrl clicks
  }, [lastClickedIdx, selectedIds, displayImages, openLightbox]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastClickedIdx(null);
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // Delete each individually, track which succeeded
    const succeeded = new Set<number>();
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/browse/exclude-image/${id}`, { method: 'POST', credentials: 'include' });
        if (res.ok) succeeded.add(id);
      } catch {}
    }));
    if (succeeded.size > 0) {
      setImages((prev) => prev.filter((i) => !succeeded.has(i.Id)));
      setTotalRows((prev) => prev - succeeded.size);
    }
    clearSelection();
  }, [selectedIds, clearSelection]);

  const handleBulkUnassign = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/browse/bulk-set-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image_ids: ids, status: 'unassigned' }),
      });
      if (res.ok) {
        setImages((prev) => prev.filter((i) => !selectedIds.has(i.Id)));
        setTotalRows((prev) => prev - ids.length);
      }
    } catch { /* error */ }
    clearSelection();
  }, [selectedIds, clearSelection]);

  // Grid-level keyboard shortcuts — active when images are selected (no lightbox open)
  useEffect(() => {
    if (lightboxIndex !== null) return;
    if (selectedIds.size === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'x' && isAdmin) {
        e.preventDefault();
        handleBulkDelete();
      } else if (e.key === 'f' && isAdmin) {
        e.preventDefault();
        document.getElementById('multiselect-fruit-input')?.focus();
      } else if (e.key === 'v' && isAdmin) {
        e.preventDefault();
        document.getElementById('multiselect-variety-input')?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, selectedIds, isAdmin, handleBulkDelete, clearSelection]);

  const handleBulkReassign = useCallback(async (imageIds: number[], newPlantId: string) => {
    try {
      const res = await fetch('/api/browse/bulk-reassign-images', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: imageIds, plant_id: newPlantId }),
      });
      if (res.ok) {
        setImages((prev) => prev.filter((i) => !imageIds.includes(i.Id)));
        setTotalRows((prev) => prev - imageIds.length);
      }
    } catch {}
  }, []);

  const handleBulkVariety = useCallback(async (imageIds: number[], varietyName: string | null) => {
    try {
      const res = await fetch('/api/browse/bulk-set-variety', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: imageIds, variety_name: varietyName }),
      });
      if (res.ok) {
        setImages((prev) =>
          prev.map((i) => imageIds.includes(i.Id) ? { ...i, Variety_Name: varietyName } as any : i)
        );
      }
    } catch {}
  }, []);

  const restoreImage = useCallback(async (img: BrowseImage) => {
    try {
      const res = await fetch(`/api/browse/restore-image/${img.Id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setImages((prev) =>
          prev.map((i) => (i.Id === img.Id ? { ...i, Excluded: false, Status: 'assigned' } as any : i))
        );
      }
    } catch {}
  }, []);

  const GoldStar = () => (
    <div className="absolute top-1 left-1 z-10 text-yellow-400 drop-shadow-md" title="Hero image">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5">
        <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" />
      </svg>
    </div>
  );

  const handleUpload = useCallback(async () => {
    if (uploadFiles.length === 0) return;
    setIsUploading(true);
    setUploadProgress(`Uploading 0/${uploadFiles.length}...`);
    try {
      const formData = new FormData();
      uploadFiles.forEach(f => formData.append('images', f));
      if (uploadVariety) formData.append('variety_name', uploadVariety);
      const res = await fetch(`/api/browse/upload-images/${plantId}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadProgress(`Uploaded ${data.uploaded} images`);
        setUploadFiles([]);
        // Refresh gallery
        setTimeout(() => {
          setShowUploadDialog(false);
          setUploadProgress('');
          fetchImages();
        }, 1000);
      } else {
        const err = await res.json().catch(() => ({}));
        setUploadProgress(`Error: ${err.error || 'Upload failed'}`);
      }
    } catch {
      setUploadProgress('Error: Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [uploadFiles, uploadVariety, plantId, fetchImages]);

  if (isLoading) {
    return (
      <div className={GALLERY_GRID_CLASSES[thumbSize]}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center space-y-3">
        <p className="text-lg text-muted-foreground">No images available</p>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setShowUploadDialog(true)}>
            <Upload className="size-4 mr-1" /> Add Images
          </Button>
        )}
        {/* Upload dialog needed here too */}
        <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!open) { setShowUploadDialog(false); setUploadFiles([]); setUploadProgress(''); setUploadVariety(''); } }}>
          <DialogContent className="max-w-md">
            <DialogTitle>Add Images to {plantId}</DialogTitle>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/30 hover:border-muted-foreground/50"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const files = Array.from(e.dataTransfer.files).filter(f => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name)); setUploadFiles(prev => [...prev, ...files]); }}
            >
              <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">Drag and drop images here, or</p>
              <label className="cursor-pointer">
                <span className="text-sm font-medium text-blue-600 hover:text-blue-800 underline">browse files</span>
                <input type="file" multiple accept="image/*" className="sr-only" onChange={(e) => { setUploadFiles(prev => [...prev, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
              </label>
            </div>
            {uploadFiles.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {uploadFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                    <span className="truncate mr-2">{f.name}</span>
                    <button className="text-destructive" onClick={() => setUploadFiles(prev => prev.filter((_, j) => j !== i))}>&times;</button>
                  </div>
                ))}
              </div>
            )}
            {uploadProgress && <p className="text-sm text-muted-foreground">{uploadProgress}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowUploadDialog(false); setUploadFiles([]); }}>Cancel</Button>
              <Button onClick={handleUpload} disabled={isUploading || uploadFiles.length === 0}>
                {isUploading ? 'Uploading...' : `Upload ${uploadFiles.length}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const renderImageThumbnail = (img: BrowseImage, idx: number) => {
    const isSelected = selectedIds.has(img.Id);
    const imgStatus = (img as any).Status || 'assigned';
    const statusOverlay = imgStatus === 'hidden' ? { bg: 'bg-red-500/40', label: 'HIDDEN', labelBg: 'bg-red-600/80' }
      : imgStatus === 'unassigned' ? { bg: 'bg-amber-500/30', label: 'UNASSIGNED', labelBg: 'bg-amber-600/80' }
      : imgStatus === 'unclassified' ? { bg: 'bg-gray-500/30', label: 'UNCLASSIFIED', labelBg: 'bg-gray-600/80' }
      : null;
    return (
    <div key={img.Id} className="space-y-1">
      <div
        className={`group aspect-square bg-muted rounded overflow-hidden cursor-pointer transition-shadow relative ${
          isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-ring'
        }`}
        onClick={(e) => handleImageClick(e, img.Id, idx)}
      >
        {statusOverlay && (
          <div className={`absolute inset-0 z-10 ${statusOverlay.bg} flex items-center justify-center`}>
            <span className={`text-white text-[9px] font-bold ${statusOverlay.labelBg} px-1.5 py-0.5 rounded`}>{statusOverlay.label}</span>
          </div>
        )}
        <div className={`w-full h-full ${rotationClass((img as any).Rotation)} ${isSelected ? 'opacity-75' : ''}`}>
          <LazyImage
            src={`${buildImageUrl(img.File_Path)}`}
            alt={img.Caption ?? ''}
            className="w-full h-full"
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth > 0) {
                setDimMap((prev) => ({ ...prev, [img.Id]: `${el.naturalWidth}×${el.naturalHeight}` }));
              }
            }}
          />
        </div>
        {isSelected && (
          <div className="absolute top-1 right-1 z-10 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            ✓
          </div>
        )}
        {/* Resolution overlay */}
        {(dimMap[img.Id] || img.Size_Bytes > 0) && (
          <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/70 text-white text-[9px] px-1 py-0.5 text-center font-mono">
            {dimMap[img.Id] ?? ''}{dimMap[img.Id] && img.Size_Bytes > 0 ? ' · ' : ''}{img.Size_Bytes > 0 ? `${(img.Size_Bytes / 1024).toFixed(0)}KB` : ''}
          </div>
        )}
        {isHero(img) && <GoldStar />}
        {isAdmin && !isSelected && (
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
    );
  };

  return (
    <div className="space-y-4">
      {/* Selection action bar — fixed at bottom of viewport */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-16 left-4 right-4 z-50 bg-blue-600 text-white rounded-lg p-2 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium shrink-0">{selectedIds.size} selected</span>
            <Button variant="secondary" size="sm" className="h-6 text-xs px-2" onClick={handleBulkDelete}>
              <Trash2 className="size-3 mr-1" /> Hide
            </Button>
            <Button variant="secondary" size="sm" className="h-6 text-xs px-2" onClick={handleBulkUnassign}>
              Unassign
            </Button>
            {isAdmin && (
              <div className="flex items-center gap-1 flex-1 min-w-[140px]">
                <PlantAutocomplete
                  label="Fruit:"
                  labelClassName="text-[10px] font-medium shrink-0 text-white"
                  placeholder="Move to..."
                  inputClassName="h-6 text-xs"
                  inputId="multiselect-fruit-input"
                  whiteBackground
                  dropdownLeftClass="left-0"
                  excludePlantId={plantId}
                  showCategory
                  confirmMessage={(p) => `Move ${selectedIds.size} images to ${p.Canonical_Name}?`}
                  confirmLabel="Move"
                  createMessage={(name) => `Create "${name}" and move ${selectedIds.size} images?`}
                  createLabel="Create & Move"
                  onSelect={async (plant) => {
                    const ids = [...selectedIds];
                    await handleBulkReassign(ids, plant.Id1);
                    clearSelection();
                  }}
                  onCreateAndSelect={async (_name, slug) => {
                    const ids = [...selectedIds];
                    await handleBulkReassign(ids, slug);
                    clearSelection();
                  }}
                />
              </div>
            )}
            {isAdmin && (
              <div className="flex items-center gap-1 min-w-[120px]">
                <GroupVarietyPicker
                  plantId={plantId}
                  imageIds={[...selectedIds]}
                  whiteBackground
                  inputId="multiselect-variety-input"
                  onSet={async (name) => {
                    await handleBulkVariety([...selectedIds], name);
                    clearSelection();
                  }}
                />
              </div>
            )}
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-white hover:text-white hover:bg-blue-700 ml-auto" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground shrink-0">{filteredImages.length}{filteredImages.length !== totalRows ? ` / ${totalRows}` : ''} images</p>
          <input
            type="text"
            value={filenameFilter}
            onChange={e => setFilenameFilter(e.target.value)}
            placeholder="Filter by filename..."
            className="h-7 text-xs border rounded px-2 w-36"
          />
          <select
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value as any)}
            className="h-7 text-xs border rounded px-1"
          >
            <option value="default">Default</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="rounded" />
            Hidden
          </label>
        </div>
        <div className="flex gap-1 items-center">
          <ThumbSizeToggle value={thumbSize} onChange={setThumbSize} />
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            onClick={() => { setViewMode('grid'); clearSelection(); }} title="Grid view">
            <LayoutGrid className="size-4" />
          </Button>
          <Button variant={viewMode === 'grouped' ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            onClick={() => { setViewMode('grouped'); clearSelection(); }} title="Group by directory">
            <FolderOpen className="size-4" />
          </Button>
          <Button variant={viewMode === 'variety' ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            onClick={() => { setViewMode('variety'); clearSelection(); }} title="Group by variety">
            <Tags className="size-4" />
          </Button>
          <Button variant={viewMode === 'similarity' ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            onClick={() => { setViewMode('similarity'); clearSelection(); }} title="Group by similarity">
            <Copy className="size-4" />
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" className="h-8 ml-2" onClick={() => setShowUploadDialog(true)}>
              <Upload className="size-4 mr-1" /> Add Images
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'grid' ? (
        <>
          <div className={GALLERY_GRID_CLASSES[thumbSize]}>
            {displayImages.map((img, idx) => renderImageThumbnail(img, idx))}
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
        </>
      ) : (
        <div className="space-y-6">
          {groupedImages.slice(0, visibleGroupCount).map(([dirLabel, groupImgs], groupIdx) => {
            const groupIds = groupImgs.map((i) => i.Id);
            const globalStartIdx = displayImagesRef.current.findIndex((i) => i.Id === groupImgs[0].Id);
            return (
              <div key={`group-${groupIdx}-${groupImgs[0]?.Id ?? dirLabel}`} className="space-y-2">
                <div className="border-b pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    {viewMode === 'variety' ? <Tags className="size-4 text-muted-foreground shrink-0" /> :
                     viewMode === 'similarity' ? <Copy className="size-4 text-muted-foreground shrink-0" /> :
                     <FolderOpen className="size-4 text-muted-foreground shrink-0" />}
                    <p className="text-sm font-medium truncate">{dirLabel || '(root)'}</p>
                    <Badge variant="outline" className="text-xs shrink-0">{groupImgs.length}</Badge>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-4 mt-1">
                      <div className="flex-1">
                        <PlantAutocomplete
                          label="Move to:"
                          labelClassName="text-[10px] font-medium shrink-0 text-muted-foreground"
                          placeholder="Plant name..."
                          inputClassName="h-6 text-xs"
                          whiteBackground
                          dropdownLeftClass="left-0"
                          excludePlantId={plantId}
                          showCategory
                          confirmMessage={(p) => `Move ${groupIds.length} images to ${p.Canonical_Name}?`}
                          confirmLabel="Move all"
                          createMessage={(name) => `Create "${name}" and move ${groupIds.length} images?`}
                          createLabel="Create & Move"
                          onSelect={async (plant) => {
                            await handleBulkReassign(groupIds, plant.Id1);
                          }}
                          onCreateAndSelect={async (_name, slug) => {
                            await handleBulkReassign(groupIds, slug);
                          }}
                        />
                      </div>
                      <div className="flex-1">
                        <GroupVarietyPicker
                          plantId={plantId}
                          imageIds={groupIds}
                          onSet={(name) => handleBulkVariety(groupIds, name)}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className={GALLERY_GRID_CLASSES[thumbSize]}>
                  {groupImgs.map((img) => {
                    const idx = displayImages.indexOf(img);
                    return renderImageThumbnail(img, idx >= 0 ? idx : 0);
                  })}
                </div>
              </div>
            );
          })}

          {/* Infinite scroll sentinel */}
          {visibleGroupCount < groupedImages.length && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              Loading more groups... ({visibleGroupCount} of {groupedImages.length} shown)
            </div>
          )}

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
                {lightboxIndex !== null && lightboxIndex < displayImages.length - 1 && (
                  <button onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                  >&#8250;</button>
                )}

                <div className="relative flex items-center justify-center overflow-hidden" style={{ height: '55vh' }}>
                  <img
                    ref={lightboxImgRef}
                    src={`${buildImageUrl(lightboxImage.File_Path)}`}
                    alt={lightboxImage.Caption ?? ''}
                    className="object-contain rounded"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '55vh',
                      ...rotationStyle((lightboxImage as any).Rotation),
                      // For 90/270 rotation, constrain by swapping max dimensions
                      ...(((((lightboxImage as any).Rotation ?? 0) % 360 + 360) % 360 === 90 ||
                           (((lightboxImage as any).Rotation ?? 0) % 360 + 360) % 360 === 270)
                        ? { maxWidth: '55vh', maxHeight: '100%' }
                        : {}),
                    }}
                    onLoad={handleImageLoad}
                  />
                  {isHero(lightboxImage) && <GoldStar />}
                </div>
              </div>

              {/* Info section — stacked rows */}
              <div className="space-y-2 px-1">
                {/* Row 1: file info */}
                <div>
                  {isAdmin ? (
                    <EditableCaption
                      imageId={lightboxImage.Id}
                      caption={lightboxImage.Caption ?? ''}
                      onSaved={(newCaption) => {
                        setImages(prev => prev.map(i => i.Id === lightboxImage.Id ? { ...i, Caption: newCaption } as any : i));
                      }}
                    />
                  ) : (
                    lightboxImage.Caption && <p className="text-sm font-medium">{lightboxImage.Caption}</p>
                  )}
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {toRelativeImagePath(lightboxImage.File_Path)}
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
                        {lightboxIndex + 1} / {displayImages.length}
                      </span>
                    )}
                  </div>
                  {/* Attribution & License */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {(lightboxImage as any).Attribution && (
                      <span>© {(lightboxImage as any).Attribution}</span>
                    )}
                    {(lightboxImage as any).License && (
                      <span>({(lightboxImage as any).License})</span>
                    )}
                  </div>
                </div>

                {/* Row 2: plant reassign + variety picker */}
                {isAdmin && lightboxImage && (
                  <div className="space-y-1">
                    <PlantAutocomplete
                      label="Plant:"
                      placeholder="Reassign to another plant... (p)"
                      excludePlantId={plantId}
                      resetKey={lightboxImage.Id}
                      externalInputRef={plantInputRef}
                      showCategory
                      confirmMessage={(p) => `Move this image to ${p.Canonical_Name}?`}
                      confirmLabel="Move"
                      createMessage={(name) => `Plant "${name}" doesn't exist. Create it and move this image?`}
                      createLabel="Create & Move"
                      onSelect={async (plant) => {
                        try {
                          const res = await fetch(`/api/browse/reassign-image/${lightboxImage.Id}`, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ plant_id: plant.Id1 }),
                          });
                          if (res.ok) {
                            setImages((prev) => {
                              const next = prev.filter((i) => i.Id !== lightboxImage.Id);
                              if (next.length === 0 || (lightboxIndex !== null && lightboxIndex >= next.length)) {
                                closeLightbox();
                              }
                              return next;
                            });
                            setTotalRows((prev) => prev - 1);
                          }
                        } catch {}
                      }}
                      onCreateAndSelect={async (_name, slug) => {
                        try {
                          const res = await fetch(`/api/browse/reassign-image/${lightboxImage.Id}`, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ plant_id: slug }),
                          });
                          if (res.ok) {
                            setImages((prev) => {
                              const next = prev.filter((i) => i.Id !== lightboxImage.Id);
                              if (next.length === 0 || (lightboxIndex !== null && lightboxIndex >= next.length)) {
                                closeLightbox();
                              }
                              return next;
                            });
                            setTotalRows((prev) => prev - 1);
                          }
                        } catch {}
                      }}
                    />
                    <VarietyPicker
                      plantId={plantId}
                      externalInputRef={varietyInputRef}
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
                    {(lightboxImage as any).Status === 'hidden' || (lightboxImage as any).Status === 'unassigned' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restoreImage(lightboxImage)}
                        title="Restore to assigned"
                        className="text-green-600 border-green-600 hover:bg-green-50"
                      >
                        Restore
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteImage(lightboxImage)}
                          title="Hide image (x)"
                        >
                          Hide (x)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unassignImage(lightboxImage)}
                          title="Mark as unassigned (u)"
                        >
                          Unassign (u)
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moveToDocuments(lightboxImage)}
                      title="Move to Attachments (a)"
                    >
                      Attach (a)
                    </Button>
                    <label className="cursor-pointer">
                      <Button variant="outline" size="sm" asChild>
                        <span>Replace</span>
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !lightboxImage) return;
                          e.target.value = '';
                          const formData = new FormData();
                          formData.append('image', file);
                          try {
                            const res = await fetch(`/api/browse/replace-image/${lightboxImage.Id}`, {
                              method: 'POST',
                              credentials: 'include',
                              body: formData,
                            });
                            if (res.ok) {
                              const data = await res.json();
                              // Replace old image with new in local state
                              setImages(prev => prev.map(i =>
                                i.Id === lightboxImage.Id ? data.newImage : i
                              ));
                              setImageDimensions(null);
                            }
                          } catch { /* error */ }
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!open) { setShowUploadDialog(false); setUploadFiles([]); setUploadProgress(''); setUploadVariety(''); } }}>
        <DialogContent className="max-w-md"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation();
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) setUploadFiles(prev => [...prev, ...files]);
          }}
        >
          <DialogTitle>Add Images to {plantId}</DialogTitle>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              uploadFiles.length > 0 ? 'border-blue-400 bg-blue-50' : 'border-muted-foreground/30 hover:border-muted-foreground/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const files = Array.from(e.dataTransfer.files).filter(f => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name));
              if (files.length === 0) {
                // If filter removed all files, try without filter (user might be dragging non-standard extensions)
                const allFiles = Array.from(e.dataTransfer.files);
                if (allFiles.length > 0) setUploadFiles(prev => [...prev, ...allFiles]);
              } else {
                setUploadFiles(prev => [...prev, ...files]);
              }
            }}
          >
            <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">Drag and drop images here, or</p>
            <label className="cursor-pointer">
              <span className="text-sm font-medium text-blue-600 hover:text-blue-800 underline">browse files</span>
              <input
                type="file"
                multiple
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setUploadFiles(prev => [...prev, ...files]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {uploadFiles.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">{uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} selected:</div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {uploadFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                    <span className="truncate mr-2">{f.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                      <button className="text-destructive hover:text-destructive/80" onClick={() => setUploadFiles(prev => prev.filter((_, j) => j !== i))}>
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Variety selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground shrink-0">Variety:</label>
            <input
              type="text"
              value={uploadVariety}
              onChange={e => setUploadVariety(e.target.value)}
              placeholder="(optional)"
              className="flex-1 h-7 text-xs border rounded px-2 bg-background"
            />
          </div>

          {uploadProgress && <p className="text-sm text-muted-foreground">{uploadProgress}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowUploadDialog(false); setUploadFiles([]); setUploadProgress(''); setUploadVariety(''); }}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={isUploading || uploadFiles.length === 0}>
              {isUploading ? 'Uploading...' : `Upload ${uploadFiles.length} image${uploadFiles.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
