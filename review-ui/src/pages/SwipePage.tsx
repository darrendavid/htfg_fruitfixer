import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { SwipeCard } from '@/components/swipe/SwipeCard';
import { SwipeActions } from '@/components/swipe/SwipeActions';
import { DetailPanel } from '@/components/swipe/DetailPanel';
import { Skeleton } from '@/components/ui/skeleton';
import type { QueueItem, ReferenceImage } from '@/types/api';

export function SwipePage() {
  const [item, setItem] = useState<QueueItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [queueEmpty, setQueueEmpty] = useState(false);

  const fetchNext = useCallback(async () => {
    setIsLoading(true);
    setShowDetail(false);
    try {
      const res = await fetch('/api/queue/next?type=swipe', { credentials: 'include' });
      const data = await res.json();
      if (data.item) {
        setItem(data.item);
        setRemaining(data.remaining);
        setQueueEmpty(false);
        // Fetch reference images if plant available
        const plantId = data.item.suggested_plant_id ?? data.item.current_plant_id;
        if (plantId) {
          fetch(`/api/plants/${plantId}/reference-images`, { credentials: 'include' })
            .then(r => r.json())
            .then(d => setReferenceImages(d.images ?? []))
            .catch(() => setReferenceImages([]));
        } else {
          setReferenceImages([]);
        }
      } else {
        setItem(null);
        setQueueEmpty(true);
      }
    } catch {
      // Error handled by parent in T22
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load first item on mount
  useEffect(() => { fetchNext(); }, [fetchNext]);

  const handleAction = async (action: () => Promise<void>) => {
    if (!item || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await action();
      await fetchNext();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = () => handleAction(async () => {
    await fetch('/api/review/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item!.image_path }),
      credentials: 'include',
    });
  });

  const handleReject = () => handleAction(async () => {
    await fetch('/api/review/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item!.image_path }),
      credentials: 'include',
    });
  });

  const handleIdk = () => handleAction(async () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400);
    const res = await fetch('/api/review/idk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item!.image_path }),
      credentials: 'include',
    });
    const data = await res.json();
    if (data.escalated) {
      toast.info('Image escalated to expert review');
    }
  });

  return (
    <AuthGuard>
      <AppShell
        title="HTFG Image Review"
        subtitle={remaining > 0 ? `${remaining} remaining` : undefined}
      >
        {showDetail && item && (
          <DetailPanel
            item={item}
            referenceImages={referenceImages}
            onClose={() => setShowDetail(false)}
          />
        )}

        {isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="w-full aspect-[4/3] rounded-lg" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-32" />
          </div>
        )}

        {!isLoading && queueEmpty && (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <p className="text-4xl mb-4">🎉</p>
            <p className="text-xl font-semibold">Swipe queue complete!</p>
            <p className="text-muted-foreground mt-2">All images have been reviewed.</p>
          </div>
        )}

        {!isLoading && item && (
          <>
            <SwipeCard
              item={item}
              onConfirm={handleConfirm}
              onReject={handleReject}
              onShowDetail={() => setShowDetail(true)}
              isSubmitting={isSubmitting}
              isShaking={isShaking}
            />
            <SwipeActions
              onConfirm={handleConfirm}
              onReject={handleReject}
              onIdk={handleIdk}
              isSubmitting={isSubmitting}
            />
          </>
        )}
      </AppShell>
    </AuthGuard>
  );
}
