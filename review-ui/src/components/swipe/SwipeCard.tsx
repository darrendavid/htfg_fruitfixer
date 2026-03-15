import { useSwipeable } from 'react-swipeable';
import { cn } from '@/lib/utils';
import { LazyImage } from '@/components/images/LazyImage';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import type { QueueItem } from '@/types/api';

interface SwipeCardProps {
  item: QueueItem;
  onConfirm: () => void;
  onReject: () => void;
  onShowDetail: () => void;
  isSubmitting: boolean;
  isShaking?: boolean;
}

export function SwipeCard({
  item,
  onConfirm,
  onReject,
  onShowDetail,
  isSubmitting,
  isShaking = false,
}: SwipeCardProps) {
  const handlers = useSwipeable({
    onSwipedLeft: () => !isSubmitting && onReject(),
    onSwipedRight: () => !isSubmitting && onConfirm(),
    onSwipedUp: () => onShowDetail(),
    trackMouse: true,
    preventScrollOnSwipe: true,
  });

  const plantName = item.suggested_plant_name ?? item.current_plant_name ?? 'Unknown Plant';
  const imageSrc = item.thumbnail_path
    ? `/thumbnails/${item.thumbnail_path.replace(/^.*?\.thumbnails[\\/]/, '')}`
    : `/images/${item.image_path}`;

  return (
    <div
      {...handlers}
      className={cn(
        'flex flex-col select-none touch-none',
        isShaking && 'animate-shake'
      )}
    >
      {/* Image */}
      <div className="relative bg-muted" style={{ aspectRatio: '4/3' }}>
        <LazyImage
          src={imageSrc}
          alt={plantName}
          className="w-full h-full"
        />
      </div>

      {/* Plant info */}
      <div className="px-4 py-3 space-y-1">
        <p className="text-lg font-semibold leading-tight">{plantName}</p>
        <ConfidenceBadge confidence={item.confidence} />
        <p className="text-xs text-muted-foreground mt-1">↑ Swipe up for details</p>
      </div>
    </div>
  );
}
