import { LazyImage } from './LazyImage';
import type { ReferenceImage } from '@/types/api';

interface ReferencePhotoGridProps {
  images: ReferenceImage[];
}

export function ReferencePhotoGrid({ images }: ReferencePhotoGridProps) {
  if (images.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No reference photos available.</p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {images.map((img) => (
        <LazyImage
          key={img.path}
          src={img.thumbnail}
          alt="Reference photo"
          className="aspect-square rounded-md"
        />
      ))}
    </div>
  );
}
