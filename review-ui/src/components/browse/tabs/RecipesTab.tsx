import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BrowseRecipe } from '@/types/browse';

function parsePlantIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

interface RecipesTabProps {
  recipes: BrowseRecipe[];
}

export function RecipesTab({ recipes }: RecipesTabProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No recipes available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recipes.map((recipe) => {
        const isExpanded = expandedId === recipe.Id;
        const plantIds = parsePlantIds(recipe.Plant_Ids);

        return (
          <Card
            key={recipe.Id}
            className={cn('p-4 cursor-pointer transition-colors hover:bg-muted/50', isExpanded && 'ring-1 ring-ring')}
            onClick={() => setExpandedId(isExpanded ? null : recipe.Id)}
          >
            <div className="flex items-start gap-2">
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

            {isExpanded && (
              <div className="mt-3 space-y-3">
                {recipe.Ingredients && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Ingredients</h4>
                    <p className="text-sm whitespace-pre-wrap">{recipe.Ingredients}</p>
                  </div>
                )}
                {recipe.Method && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Method</h4>
                    <p className="text-sm whitespace-pre-wrap">{recipe.Method}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Source: {recipe.Source_File}</p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
