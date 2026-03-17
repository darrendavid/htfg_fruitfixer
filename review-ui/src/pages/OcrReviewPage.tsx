import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LazyImage } from '@/components/images/LazyImage';
import { OcrFieldEditor } from '@/components/ocr-review/OcrFieldEditor';
import { KeyFactsList } from '@/components/ocr-review/KeyFactsList';
import { PlantTagList } from '@/components/ocr-review/PlantTagList';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { QueueItem, OcrExtraction, KeyFact, OcrStats } from '@/types/api';

const CONTENT_TYPE_OPTIONS = [
  { value: 'poster', label: 'Poster' },
  { value: 'data-sheet', label: 'Data Sheet' },
  { value: 'label', label: 'Label' },
  { value: 'sign', label: 'Sign' },
  { value: 'table', label: 'Table' },
  { value: 'other', label: 'Other' },
];

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function parseKeyFacts(raw: string | null): KeyFact[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((f: Record<string, unknown>) => ({
      field: String(f.field ?? ''),
      value: String(f.value ?? ''),
      status: f.status === 'remove' ? 'remove' as const : 'keep' as const,
    })) : [];
  } catch { return []; }
}

export function OcrReviewPage() {
  const [item, setItem] = useState<QueueItem | null>(null);
  const [ocr, setOcr] = useState<OcrExtraction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [stats, setStats] = useState<OcrStats | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [plantAssociations, setPlantAssociations] = useState<string[]>([]);
  const [keyFacts, setKeyFacts] = useState<KeyFact[]>([]);
  const [sourceContext, setSourceContext] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');

  // Auto-save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrIdRef = useRef<number | null>(null);

  const populateFields = useCallback((ocrData: OcrExtraction) => {
    setTitle(ocrData.title ?? '');
    setContentType(ocrData.content_type ?? '');
    setExtractedText(ocrData.extracted_text ?? '');
    setPlantAssociations(parseJsonArray(ocrData.plant_associations));
    setKeyFacts(parseKeyFacts(ocrData.key_facts));
    setSourceContext(ocrData.source_context ?? '');
    setReviewerNotes(ocrData.reviewer_notes ?? '');
    ocrIdRef.current = ocrData.id;
  }, []);

  const fetchNext = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/ocr-review/next', { credentials: 'include' });
      const data = await res.json();
      if (data.item && data.ocr) {
        setItem(data.item);
        setOcr(data.ocr);
        populateFields(data.ocr);
        setRemaining(data.remaining);
        setQueueEmpty(false);
      } else {
        setItem(null);
        setOcr(null);
        setQueueEmpty(true);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  }, [populateFields]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/ocr-review/stats', { credentials: 'include' });
      const data = await res.json();
      setStats(data.stats);
    } catch {}
  }, []);

  useEffect(() => { fetchNext(); fetchStats(); }, [fetchNext, fetchStats]);

  // Build the current form data for saving
  const buildSavePayload = useCallback(() => ({
    title,
    extracted_text: extractedText,
    key_facts: JSON.stringify(keyFacts),
    plant_associations: JSON.stringify(plantAssociations),
    source_context: sourceContext,
    reviewer_notes: reviewerNotes,
  }), [title, extractedText, keyFacts, plantAssociations, sourceContext, reviewerNotes]);

  // Auto-save draft (debounced 2s)
  useEffect(() => {
    if (!ocrIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const id = ocrIdRef.current;
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/ocr-review/${id}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSavePayload()),
          credentials: 'include',
        });
      } catch {}
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, contentType, extractedText, plantAssociations, keyFacts, sourceContext, reviewerNotes, buildSavePayload]);

  const handleApprove = async () => {
    if (!ocr || isSubmitting) return;
    setIsSubmitting(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await fetch(`/api/ocr-review/${ocr.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSavePayload()),
        credentials: 'include',
      });
      await fetchNext();
      await fetchStats();
    } finally { setIsSubmitting(false); }
  };

  const handleReject = async () => {
    if (!ocr || isSubmitting) return;
    setIsSubmitting(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await fetch(`/api/ocr-review/${ocr.id}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      await fetchNext();
      await fetchStats();
    } finally { setIsSubmitting(false); }
  };

  const handleSkip = async () => {
    if (!item) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await fetch(`/api/queue/${item.id}/release`, {
      method: 'POST',
      credentials: 'include',
    });
    await fetchNext();
  };

  const imageSrc = item?.thumbnail_path
    ? `/thumbnails/${item.thumbnail_path}`
    : item ? `/images/${item.image_path}` : '';

  const progressPercent = stats
    ? stats.total > 0 ? Math.round(((stats.approved + stats.rejected) / stats.total) * 100) : 0
    : 0;

  return (
    <AuthGuard>
      <AppShell
        title="OCR Review"
        subtitle={remaining > 0 ? `${remaining} remaining` : undefined}
      >
        {isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="w-full aspect-[4/3] rounded-lg" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {!isLoading && queueEmpty && (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <p className="text-4xl mb-4">🎉</p>
            <p className="text-xl font-semibold">OCR review queue complete!</p>
            {stats && (
              <p className="text-sm text-muted-foreground mt-2">
                {stats.approved} approved, {stats.rejected} rejected of {stats.total} total
              </p>
            )}
          </div>
        )}

        {!isLoading && item && ocr && (
          <div className="flex flex-col md:flex-row gap-0 md:gap-4 pb-4">
            {/* Image panel */}
            <div className="md:w-1/2 shrink-0">
              <div className="bg-muted md:sticky md:top-16" style={{ minHeight: '300px' }}>
                <LazyImage
                  src={imageSrc}
                  alt="Image for OCR review"
                  className="w-full h-full min-h-[300px] md:min-h-[calc(100vh-8rem)]"
                />
              </div>
              <div className="px-4 py-1">
                <p className="text-xs text-muted-foreground font-mono break-all">{item.image_path}</p>
              </div>
            </div>

            {/* Extracted data panel */}
            <div className="md:w-1/2 space-y-4 px-4 py-2">
              {/* Progress */}
              {stats && stats.total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stats.approved + stats.rejected} reviewed</span>
                    <span>{stats.total} total</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>
              )}

              {/* Title */}
              <OcrFieldEditor
                label="Title"
                value={title}
                onChange={setTitle}
                placeholder="Document title..."
              />

              {/* Content Type */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Content Type</Label>
                <Select value={contentType} onValueChange={setContentType}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select content type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Extracted Text */}
              <OcrFieldEditor
                label="Extracted Text"
                value={extractedText}
                onChange={setExtractedText}
                type="textarea"
                rows={8}
                placeholder="OCR extracted text..."
              />

              {/* Plant Associations */}
              <PlantTagList
                plants={plantAssociations}
                onChange={setPlantAssociations}
              />

              {/* Key Facts */}
              <KeyFactsList
                facts={keyFacts}
                onChange={setKeyFacts}
              />

              {/* Source Context */}
              <OcrFieldEditor
                label="Source Context"
                value={sourceContext}
                onChange={setSourceContext}
                placeholder="Where this image was found..."
              />

              {/* Reviewer Notes */}
              <OcrFieldEditor
                label="Reviewer Notes"
                value={reviewerNotes}
                onChange={setReviewerNotes}
                type="textarea"
                rows={3}
                placeholder="Add your notes..."
              />

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 pb-4 sticky bottom-14 bg-background border-t mt-4 -mx-4 px-4 pt-3">
                <Button
                  variant="default"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleApprove}
                  disabled={isSubmitting}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleReject}
                  disabled={isSubmitting}
                >
                  Reject
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSkip}
                  disabled={isSubmitting}
                >
                  Skip
                </Button>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
