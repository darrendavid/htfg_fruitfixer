import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazyImage } from '@/components/images/LazyImage';
import { buildImageUrl, rotationStyle } from '@/lib/gallery-utils';
import type { BrowseVariety } from '@/types/browse';

interface VarietyCardProps {
  variety: BrowseVariety;
  onClick: (v: BrowseVariety) => void;
  compact?: boolean;
}

// Simple in-memory cache so switching back to card view doesn't refetch
const heroCache = new Map<number, { src: string; rotation: number } | null>();

export function VarietyCard({ variety, onClick, compact }: VarietyCardProps) {
  const [hero, setHero] = useState<{ src: string; rotation: number } | null>(
    heroCache.has(variety.Id) ? (heroCache.get(variety.Id) ?? null) : null
  );

  useEffect(() => {
    if (heroCache.has(variety.Id)) return;
    let cancelled = false;
    fetch(`/api/browse/varieties/${variety.Id}/images`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { images: [] })
      .then((data) => {
        if (cancelled) return;
        const first = (data.images ?? [])[0];
        if (first) {
          const entry = { src: buildImageUrl(first.File_Path), rotation: first.Rotation ?? 0 };
          heroCache.set(variety.Id, entry);
          setHero(entry);
        } else {
          heroCache.set(variety.Id, null);
        }
      })
      .catch(() => { heroCache.set(variety.Id, null); });
    return () => { cancelled = true; };
  }, [variety.Id]);

  return (
    <Card
      className={`overflow-hidden cursor-pointer hover:ring-2 hover:ring-ring transition-shadow flex flex-col ${compact ? 'min-h-0' : 'min-h-[240px]'}`}
      onClick={() => onClick(variety)}
      data-testid={`variety-card-${variety.Id}`}
    >
      {/* Hero image */}
      <div className="aspect-square bg-muted relative">
        {hero ? (
          <LazyImage
            src={hero.src}
            alt={variety.Variety_Name}
            className="w-full h-full"
            style={rotationStyle(hero.rotation)}
            objectFit={hero.rotation && hero.rotation % 180 !== 0 ? 'contain' : 'cover'}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-3xl">
            <span aria-hidden="true">&#x1F331;</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-1 flex-1 ${compact ? 'p-1' : 'p-2'}`}>
        <p className={`font-bold leading-tight line-clamp-2 ${compact ? 'text-xs' : 'text-sm'}`}>{variety.Variety_Name}</p>
        {!compact && variety.Alternative_Names && (
          <p className="italic text-xs text-muted-foreground leading-tight line-clamp-1">
            {variety.Alternative_Names}
          </p>
        )}
        {!compact && variety.Genome_Group && (
          <div className="mt-auto pt-1">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {variety.Genome_Group}
            </Badge>
          </div>
        )}
      </div>
    </Card>
  );
}
