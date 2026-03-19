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
  onSlugChanged?: (newSlug: string) => void;
}

export function OverviewTab({ plant, varietyCount, documentCount, recipeCount, editMode, onPlantUpdated, onSlugChanged }: OverviewTabProps) {
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
  const [editAltNames, setEditAltNames] = useState((plant as any).Alternative_Names ?? '');
  const [editOrigin, setEditOrigin] = useState((plant as any).Origin ?? '');
  const [editFlowerColors, setEditFlowerColors] = useState((plant as any).Flower_Colors ?? '');
  const [editElevation, setEditElevation] = useState((plant as any).Elevation_Range ?? '');
  const [editDistribution, setEditDistribution] = useState((plant as any).Distribution ?? '');
  const [editCulinaryRegions, setEditCulinaryRegions] = useState((plant as any).Culinary_Regions ?? '');
  const [editPrimaryUse, setEditPrimaryUse] = useState((plant as any).Primary_Use ?? '');
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
          Alternative_Names: editAltNames || null,
          Origin: editOrigin || null,
          Flower_Colors: editFlowerColors || null,
          Elevation_Range: editElevation || null,
          Distribution: editDistribution || null,
          Culinary_Regions: editCulinaryRegions || null,
          Primary_Use: editPrimaryUse || null,
        }),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.Id1 ? data : (data.plant ?? { ...plant, Canonical_Name: editName, Botanical_Name: editBotanical || null, Description: editDescription || null });
        onPlantUpdated(updated);
        // If slug changed, navigate to new URL
        const newSlug = updated.Id1;
        if (newSlug && newSlug !== (plant as any).Id1 && onSlugChanged) {
          onSlugChanged(newSlug);
        }
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
    setEditAltNames((plant as any).Alternative_Names ?? '');
    setEditOrigin((plant as any).Origin ?? '');
    setEditFlowerColors((plant as any).Flower_Colors ?? '');
    setEditElevation((plant as any).Elevation_Range ?? '');
    setEditDistribution((plant as any).Distribution ?? '');
    setEditCulinaryRegions((plant as any).Culinary_Regions ?? '');
    setEditPrimaryUse((plant as any).Primary_Use ?? '');
  };

  return (
    <div className="space-y-6">
      {/* Hero image — scaled to fit viewport */}
      <div className="bg-muted rounded-lg overflow-hidden max-h-[60vh] flex items-center justify-center relative">
        {plant.Image_Count > 0 && heroSrc ? (
          <img
            src={heroSrc}
            alt={plant.Canonical_Name}
            className="max-w-full max-h-[60vh] object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-48 flex items-center justify-center text-muted-foreground text-5xl">
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
          <div>
            <label className="text-sm font-medium">Alternative Names</label>
            <Input value={editAltNames} onChange={(e) => setEditAltNames(e.target.value)} placeholder="e.g. lipstick plant, achote" />
          </div>
          <div>
            <label className="text-sm font-medium">Origin</label>
            <Input value={editOrigin} onChange={(e) => setEditOrigin(e.target.value)} placeholder="e.g. South America" />
          </div>
          <div>
            <label className="text-sm font-medium">Primary Use</label>
            <Input value={editPrimaryUse} onChange={(e) => setEditPrimaryUse(e.target.value)} placeholder="e.g. fresh eating, preserves" />
          </div>
          <div>
            <label className="text-sm font-medium">Flower Colors</label>
            <Input value={editFlowerColors} onChange={(e) => setEditFlowerColors(e.target.value)} placeholder="e.g. pink or white" />
          </div>
          <div>
            <label className="text-sm font-medium">Elevation Range</label>
            <Input value={editElevation} onChange={(e) => setEditElevation(e.target.value)} placeholder="e.g. sea level to 2000 feet" />
          </div>
          <div>
            <label className="text-sm font-medium">Distribution</label>
            <Input value={editDistribution} onChange={(e) => setEditDistribution(e.target.value)} placeholder="e.g. throughout the tropics" />
          </div>
          <div>
            <label className="text-sm font-medium">Culinary Regions</label>
            <Input value={editCulinaryRegions} onChange={(e) => setEditCulinaryRegions(e.target.value)} placeholder="e.g. Caribbean, Mexico" />
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
          <p className="text-sm text-muted-foreground whitespace-pre-wrap select-text">{plant.Description}</p>
        </div>
      )}

      {/* Extended details */}
      {!editMode && (
        <div className="space-y-2">
          {(plant as any).Alternative_Names && (
            <DetailRow label="Alternative Names" value={(plant as any).Alternative_Names} />
          )}
          {(plant as any).Origin && (
            <DetailRow label="Origin" value={(plant as any).Origin} />
          )}
          {(plant as any).Primary_Use && (
            <DetailRow label="Primary Use" value={(plant as any).Primary_Use} />
          )}
          {(plant as any).Flower_Colors && (
            <DetailRow label="Flower Colors" value={(plant as any).Flower_Colors} />
          )}
          {(plant as any).Elevation_Range && (
            <DetailRow label="Elevation Range" value={(plant as any).Elevation_Range} />
          )}
          {(plant as any).Distribution && (
            <DetailRow label="Distribution" value={(plant as any).Distribution} />
          )}
          {(plant as any).Culinary_Regions && (
            <DetailRow label="Culinary Regions" value={(plant as any).Culinary_Regions} />
          )}
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="font-medium shrink-0 w-36">{label}</span>
      <span className="text-muted-foreground select-text">{value}</span>
    </div>
  );
}
