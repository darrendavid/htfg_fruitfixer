import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazyImage } from '@/components/images/LazyImage';
import { rotationStyle, buildImageUrl } from '@/lib/gallery-utils';
import type { BrowsePlant } from '@/types/browse';

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function parseHarvestMonths(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => n >= 1 && n <= 12);
  } catch {}
  return [];
}

interface PlantCardProps {
  plant: BrowsePlant;
  /** @deprecated use size instead */
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PlantCard({ plant, compact, size }: PlantCardProps) {
  // Resolve size — backward compat with `compact`
  const resolvedSize: 'sm' | 'md' | 'lg' = size ?? (compact ? 'md' : 'lg');
  const isCompact = resolvedSize !== 'lg';
  const navigate = useNavigate();
  const harvestMonths = parseHarvestMonths(plant.Harvest_Months);
  const plantSlug = (plant as any).Id1 || plant.Id;
  const heroSrc = (plant as any).hero_image
    ? buildImageUrl((plant as any).hero_image)
    : '';

  // Font size per card size:
  //   lg  → text-base (existing)
  //   md  → text-sm (20% larger than small)
  //   sm  → text-xs (existing)
  const nameSizeClass = resolvedSize === 'lg' ? 'text-base' : resolvedSize === 'md' ? 'text-sm' : 'text-xs';
  // Padding per size:
  //   lg: slightly more bottom padding so harvest dots clear the card edge
  //   md/sm: a bit more vertical margin around the name
  const contentPaddingClass = resolvedSize === 'lg' ? 'px-2 pt-2 pb-3' : resolvedSize === 'md' ? 'px-1.5 py-2' : 'px-1 py-2';

  return (
    <Card
      className={`overflow-hidden cursor-pointer hover:ring-2 hover:ring-ring transition-shadow flex flex-col py-0 gap-0 ${isCompact ? 'min-h-0' : 'min-h-[280px]'}`}
      onClick={() => navigate(`/plants/${plantSlug}`)}
    >
      {/* Hero image — flush with top of card */}
      <div className="aspect-square bg-muted relative -mt-px">
        {heroSrc ? (
          <LazyImage
            src={heroSrc}
            alt={plant.Canonical_Name}
            className="w-full h-full"
            style={rotationStyle((plant as any).hero_rotation ?? 0)}
            objectFit={(plant as any).hero_rotation && ((plant as any).hero_rotation % 180 !== 0) ? 'contain' : 'cover'}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-3xl">
            <span aria-hidden="true">&#x1F331;</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-0.5 flex-1 ${contentPaddingClass}`}>
        <p
          className={`font-bold leading-tight line-clamp-1 ${nameSizeClass}`}
          title={plant.Canonical_Name}
        >{plant.Canonical_Name}</p>
        {!isCompact && plant.Botanical_Name && (
          <p className="italic text-xs text-muted-foreground leading-tight line-clamp-1">
            {plant.Botanical_Name}
          </p>
        )}

        {!isCompact && (
          <div className="flex items-center gap-1 mt-auto pt-0.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {plant.Category}
            </Badge>
            {plant.Image_Count > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-3">
                  <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909-4.97-4.969a.75.75 0 00-1.06 0L2.5 11.06zm6.5-3.81a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" clipRule="evenodd" />
                </svg>
                {plant.Image_Count}
              </span>
            )}
          </div>
        )}

        {/* Harvest months dots */}
        {!isCompact && harvestMonths.length > 0 && (
          <div className="flex gap-[2px] mt-0.5">
            {MONTH_LABELS.map((label, i) => (
              <div
                key={i}
                title={label}
                className={`w-2 h-2 rounded-full ${harvestMonths.includes(i + 1) ? 'bg-green-500' : 'bg-muted-foreground/20'}`}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
