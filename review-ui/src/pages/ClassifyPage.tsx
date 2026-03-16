import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LazyImage } from '@/components/images/LazyImage';
import { PlantSearch } from '@/components/classify/PlantSearch';
import { QuickPicks } from '@/components/classify/QuickPicks';
import { ClassifyActions } from '@/components/classify/ClassifyActions';
import { DiscardDialog } from '@/components/classify/DiscardDialog';
import { NewPlantDialog } from '@/components/classify/NewPlantDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecentPlants } from '@/hooks/useRecentPlants';
import type { QueueItem, Plant } from '@/types/api';

export function ClassifyPage() {
  const [item, setItem] = useState<QueueItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showNewPlant, setShowNewPlant] = useState(false);
  const { recentPlants, addRecentPlant } = useRecentPlants();

  const fetchNext = useCallback(async () => {
    setIsLoading(true);
    setSelectedPlant(null);
    try {
      const res = await fetch('/api/queue/next?type=classify', { credentials: 'include' });
      const data = await res.json();
      if (data.item) {
        setItem(data.item);
        setRemaining(data.remaining);
        setQueueEmpty(false);
      } else {
        setItem(null);
        setQueueEmpty(true);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchNext(); }, [fetchNext]);

  const handleAssign = async () => {
    if (!item || !selectedPlant || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await fetch('/api/review/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_path: item.image_path, plant_id: selectedPlant.id }),
        credentials: 'include',
      });
      addRecentPlant(selectedPlant);
      await fetchNext();
    } finally { setIsSubmitting(false); }
  };

  const handleDiscard = async (category: string, notes: string | null) => {
    if (!item) return;
    await fetch('/api/review/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item.image_path, category, notes }),
      credentials: 'include',
    });
    await fetchNext();
  };

  const handleNewPlant = async (plant: Plant) => {
    if (!item) return;
    // Classify the current image with the new plant
    await fetch('/api/review/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item.image_path, plant_id: plant.id }),
      credentials: 'include',
    });
    addRecentPlant(plant);
    await fetchNext();
  };

  const handleIgnore = async () => {
    if (!item) return;
    await fetch('/api/review/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: item.image_path }),
      credentials: 'include',
    });
    await fetchNext();
  };

  const handleSkip = async () => {
    if (!item) return;
    await fetch(`/api/queue/${item.id}/release`, {
      method: 'POST',
      credentials: 'include',
    });
    await fetchNext();
  };

  const imageSrc = item?.thumbnail_path
    ? `/thumbnails/${item.thumbnail_path}`
    : item ? `/images/${item.image_path}` : '';

  return (
    <AuthGuard>
      <AppShell
        title="Classify"
        subtitle={remaining > 0 ? `${remaining} remaining` : undefined}
      >
        {isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="w-full aspect-[4/3] rounded-lg" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!isLoading && queueEmpty && (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <p className="text-4xl mb-4">🎉</p>
            <p className="text-xl font-semibold">Classify queue complete!</p>
          </div>
        )}

        {!isLoading && item && (
          <div className="space-y-4 pb-4">
            <div className="bg-muted" style={{ aspectRatio: '4/3' }}>
              <LazyImage src={imageSrc} alt="Image to classify" className="w-full h-full" />
            </div>
            <div className="px-4">
              <p className="text-xs text-muted-foreground font-mono break-all">{item.image_path}</p>
            </div>
            <div className="px-4">
              <PlantSearch onSelect={setSelectedPlant} selectedPlant={selectedPlant} />
            </div>
            <div className="px-4">
              <QuickPicks plants={recentPlants} onSelect={setSelectedPlant} />
            </div>
            <ClassifyActions
              selectedPlant={selectedPlant}
              onAssign={handleAssign}
              onNewPlant={() => setShowNewPlant(true)}
              onDiscard={() => setShowDiscard(true)}
              onIgnore={handleIgnore}
              onSkip={handleSkip}
              isSubmitting={isSubmitting}
            />
          </div>
        )}

        <DiscardDialog
          open={showDiscard}
          onClose={() => setShowDiscard(false)}
          onDiscard={handleDiscard}
        />
        <NewPlantDialog
          open={showNewPlant}
          onClose={() => setShowNewPlant(false)}
          onCreate={handleNewPlant}
        />
      </AppShell>
    </AuthGuard>
  );
}
