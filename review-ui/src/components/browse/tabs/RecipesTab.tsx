import { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { BrowseRecipe } from '@/types/browse';

/** Inline plant search for recipe reassignment */
function RecipePlantReassigner({ recipeId, currentPlantId, onReassigned }: {
  recipeId: number;
  currentPlantId: string;
  onReassigned: (newPlantId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ Id1: string; Canonical_Name: string }>>([]);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.length < 2) { setResults([]); setShowResults(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/browse/plants-search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setResults((data.plants ?? data).filter((p: any) => p.Id1 !== currentPlantId));
        setShowResults(true);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, currentPlantId]);

  const selectPlant = (plantId: string) => {
    setQuery('');
    setShowResults(false);
    onReassigned(plantId);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground shrink-0">Move to:</span>
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Plant name..."
          className="h-7 text-xs"
          onClick={e => e.stopPropagation()}
          onFocus={() => { if (results.length > 0) setShowResults(true); }}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-12 right-0 bg-popover border rounded shadow-lg max-h-32 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.Id1}
              className="w-full text-left px-2 py-1 text-xs hover:bg-muted"
              onMouseDown={e => { e.preventDefault(); selectPlant(p.Id1); }}
            >
              {p.Canonical_Name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parsePlantIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

interface RecipesTabProps {
  plantId: string;
  recipes: BrowseRecipe[];
  onRecipesChanged?: (recipes: BrowseRecipe[]) => void;
}

export function RecipesTab({ plantId, recipes, onRecipesChanged }: RecipesTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [localRecipes, setLocalRecipes] = useState(recipes);

  const handleDelete = useCallback(async (recipeId: number) => {
    try {
      const res = await fetch(`/api/browse/recipes/${recipeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        const updated = localRecipes.filter(r => r.Id !== recipeId);
        setLocalRecipes(updated);
        onRecipesChanged?.(updated);
        toast.success('Recipe deleted');
      } else {
        toast.error('Failed to delete recipe');
      }
    } catch {
      toast.error('Failed to delete recipe');
    }
  }, [localRecipes, onRecipesChanged]);

  const handleReassign = useCallback(async (recipeId: number, newPlantId: string) => {
    try {
      const res = await fetch(`/api/browse/recipes/${recipeId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_plant_id: plantId, new_plant_id: newPlantId }),
        credentials: 'include',
      });
      if (res.ok) {
        // Remove from current view since it moved to another plant
        const updated = localRecipes.filter(r => r.Id !== recipeId);
        setLocalRecipes(updated);
        onRecipesChanged?.(updated);
        toast.success(`Recipe moved to ${newPlantId}`);
      } else {
        toast.error('Failed to move recipe');
      }
    } catch {
      toast.error('Failed to move recipe');
    }
  }, [plantId, localRecipes, onRecipesChanged]);

  if (localRecipes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No recipes available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {localRecipes.map((recipe) => {
        const isExpanded = expandedId === recipe.Id;
        const plantIds = parsePlantIds(recipe.Plant_Ids);

        return (
          <Card
            key={recipe.Id}
            className={cn('p-4 transition-colors', isExpanded && 'ring-1 ring-ring')}
          >
            {/* Header — always visible */}
            <div
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : recipe.Id)}
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{recipe.Title}</p>
                {!isExpanded && recipe.Ingredients && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {recipe.Ingredients}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                {plantIds.map((id) => (
                  <Badge key={id} variant="outline" className="text-[10px]">{id}</Badge>
                ))}
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="mt-3 space-y-3">
                {recipe.Ingredients && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Ingredients</h4>
                    <p className="text-sm whitespace-pre-wrap select-text">{recipe.Ingredients}</p>
                  </div>
                )}
                {recipe.Method && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Method</h4>
                    <p className="text-sm whitespace-pre-wrap select-text">{recipe.Method}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Source: {recipe.Source_File}</p>

                {/* Admin actions */}
                {isAdmin && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <div className="flex-1">
                      <RecipePlantReassigner
                        recipeId={recipe.Id}
                        currentPlantId={plantId}
                        onReassigned={(newPlantId) => handleReassign(recipe.Id, newPlantId)}
                      />
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleDelete(recipe.Id); }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
