import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { OverviewTab } from '@/components/browse/tabs/OverviewTab';
import { GalleryTab } from '@/components/browse/tabs/GalleryTab';
import { VarietiesTab } from '@/components/browse/tabs/VarietiesTab';
import { NutritionTab } from '@/components/browse/tabs/NutritionTab';
import { DocumentsTab } from '@/components/browse/tabs/DocumentsTab';
import { AttachmentsTab } from '@/components/browse/tabs/AttachmentsTab';
import { RecipesTab } from '@/components/browse/tabs/RecipesTab';
import { OcrTab } from '@/components/browse/tabs/OcrTab';
import { NotesTab } from '@/components/browse/tabs/NotesTab';
import type { PlantDetail, BrowsePlant, BrowseVariety, BrowseNutrient, BrowseAttachment, StaffNote } from '@/types/browse';

export function PlantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<PlantDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const overviewSaveRef = useRef<(() => Promise<void>) | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/browse/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      } else if (res.status === 404) {
        navigate('/plants', { replace: true });
      }
    } catch {
      // Network error
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handlePlantUpdated = (plant: BrowsePlant) => {
    if (detail) setDetail({ ...detail, plant });
  };

  const handleVarietiesChanged = (varieties: BrowseVariety[]) => {
    if (detail) setDetail({ ...detail, varieties });
  };

  const handleNutritionalChanged = (nutritional: BrowseNutrient[]) => {
    if (detail) setDetail({ ...detail, nutritional });
  };

  const handleNotesChanged = (notes: StaffNote[]) => {
    if (detail) setDetail({ ...detail, notes });
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthGuard>
      <AppShell
        title={detail?.plant.Canonical_Name ?? 'Plant Detail'}
        subtitle={detail?.plant.Botanical_Name ?? undefined}
      >
        {isLoading && (
          <div className="p-4 space-y-4">
            <Skeleton className="w-full aspect-video rounded-lg" />
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {!isLoading && detail && (
          <div className="p-4 space-y-4">
            {/* Header with edit toggle */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => navigate('/plants')}>
                &larr; Back
              </Button>
              {isAdmin && (
                <Button
                  variant={editMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={async () => {
                    if (editMode && overviewSaveRef.current) {
                      await overviewSaveRef.current();
                    }
                    setEditMode(!editMode);
                  }}
                >
                  {editMode ? 'Save' : 'Edit'}
                </Button>
              )}
            </div>

            {/* Tabbed content */}
            <Tabs defaultValue="overview">
              <TabsList className="w-full overflow-x-auto flex-nowrap">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="gallery">Gallery</TabsTrigger>
                <TabsTrigger value="varieties">Varieties</TabsTrigger>
                <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
                <TabsTrigger value="documents">Docs</TabsTrigger>
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
                <TabsTrigger value="recipes">Recipes</TabsTrigger>
                <TabsTrigger value="ocr">OCR</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewTab
                  plant={detail.plant}
                  varietyCount={detail.varieties.length}
                  documentCount={detail.documents.length}
                  recipeCount={detail.recipes.length}
                  editMode={editMode}
                  onPlantUpdated={handlePlantUpdated}
                  onSlugChanged={(newSlug) => navigate(`/plants/${newSlug}`, { replace: true })}
                  saveRef={overviewSaveRef}
                />
              </TabsContent>

              <TabsContent value="gallery">
                <GalleryTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  currentHeroPath={(detail.plant as any).hero_image ?? undefined}
                  onHeroChanged={(path) => {
                    setDetail((prev) => prev ? {
                      ...prev,
                      plant: { ...prev.plant, hero_image: path } as any,
                    } : prev);
                  }}
                />
              </TabsContent>

              <TabsContent value="varieties">
                <VarietiesTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  varieties={detail.varieties}
                  editMode={editMode}
                  onVarietiesChanged={handleVarietiesChanged}
                />
              </TabsContent>

              <TabsContent value="nutrition">
                <NutritionTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  nutritional={detail.nutritional}
                  editMode={editMode}
                  onNutritionalChanged={handleNutritionalChanged}
                />
              </TabsContent>

              <TabsContent value="documents">
                <DocumentsTab documents={detail.documents} />
              </TabsContent>

              <TabsContent value="attachments">
                <AttachmentsTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  attachments={detail.attachments ?? []}
                  editMode={editMode}
                />
              </TabsContent>

              <TabsContent value="recipes">
                <RecipesTab recipes={detail.recipes} />
              </TabsContent>

              <TabsContent value="ocr">
                <OcrTab ocrExtractions={detail.ocr} plantId={(detail.plant as any).Id1 || detail.plant.Id} />
              </TabsContent>

              <TabsContent value="notes">
                <NotesTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  notes={detail.notes}
                  varieties={detail.varieties}
                  onNotesChanged={handleNotesChanged}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {!isLoading && !detail && (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <p className="text-lg text-muted-foreground">Plant not found</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/plants')}>
              Back to Plants
            </Button>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
