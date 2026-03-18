import { useState } from 'react';
import { LazyImage } from '@/components/images/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { BrowsePlant } from '@/types/browse';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseHarvestMonths(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => n >= 1 && n <= 12);
  } catch {}
  return [];
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

interface OverviewTabProps {
  plant: BrowsePlant;
  varietyCount: number;
  documentCount: number;
  recipeCount: number;
  editMode: boolean;
  onPlantUpdated: (plant: BrowsePlant) => void;
}

export function OverviewTab({ plant, varietyCount, documentCount, recipeCount, editMode, onPlantUpdated }: OverviewTabProps) {
  const harvestMonths = parseHarvestMonths(plant.Harvest_Months);
  const aliases = parseAliases(plant.Aliases);
  const plantSlug = (plant as any).Id1 || plant.Id;
  const heroSrc = (plant as any).hero_image
    ? `/images/${(plant as any).hero_image}`
    : plant.Image_Count > 0 ? `/images/plants/${plantSlug}/images/` : '';

  // Edit state
  const [editName, setEditName] = useState(plant.Canonical_Name);
  const [editBotanical, setEditBotanical] = useState(plant.Botanical_Name ?? '');
  const [editDescription, setEditDescription] = useState(plant.Description ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/browse/${plant.Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Canonical_Name: editName,
          Botanical_Name: editBotanical || null,
          Description: editDescription || null,
        }),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        onPlantUpdated(data.plant ?? { ...plant, Canonical_Name: editName, Botanical_Name: editBotanical || null, Description: editDescription || null });
        toast.success('Plant updated');
      } else {
        toast.error('Failed to update plant');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(plant.Canonical_Name);
    setEditBotanical(plant.Botanical_Name ?? '');
    setEditDescription(plant.Description ?? '');
  };

  return (
    <div className="space-y-6">
      {/* Hero image */}
      <div className="aspect-video bg-muted rounded-lg overflow-hidden">
        {plant.Image_Count > 0 ? (
          <LazyImage src={heroSrc} alt={plant.Canonical_Name} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-5xl">
            <span aria-hidden="true">&#x1F331;</span>
          </div>
        )}
      </div>

      {/* Name and details */}
      {editMode ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Common Name</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Botanical Name</label>
            <Input value={editBotanical} onChange={(e) => setEditBotanical(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving} size="sm">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={handleCancel} size="sm">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{plant.Canonical_Name}</h1>
          {plant.Botanical_Name && (
            <p className="italic text-muted-foreground">{plant.Botanical_Name}</p>
          )}
          <Badge variant="secondary">{plant.Category}</Badge>
        </div>
      )}

      {/* Aliases */}
      {aliases.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-1">Also known as</h3>
          <p className="text-sm text-muted-foreground">{aliases.join(', ')}</p>
        </div>
      )}

      {/* Harvest calendar */}
      <div>
        <h3 className="text-sm font-medium mb-2">Harvest Calendar</h3>
        <div className="flex gap-1">
          {MONTH_NAMES.map((name, i) => (
            <div
              key={i}
              title={name}
              className={`flex-1 h-8 rounded text-[10px] flex items-center justify-center font-medium ${
                harvestMonths.includes(i + 1)
                  ? 'bg-green-500 text-white'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {name}
            </div>
          ))}
        </div>
      </div>

      {/* Description */}
      {!editMode && plant.Description && (
        <div>
          <h3 className="text-sm font-medium mb-1">Description</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{plant.Description}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Images" value={plant.Image_Count} />
        <StatBox label="Varieties" value={varietyCount} />
        <StatBox label="Documents" value={documentCount} />
        <StatBox label="Recipes" value={recipeCount} />
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
