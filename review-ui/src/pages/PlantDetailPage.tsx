import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
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
  const [activeTab, setActiveTab] = useState('overview');
  const overviewSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Plant list for navigator (fetched once, cached)
  const [allPlants, setAllPlants] = useState<Array<{ Id1: string; Canonical_Name: string }>>([]);
  useEffect(() => {
    // Fetch all plant slugs + names for the navigator
    async function fetchPlantList() {
      const all: Array<{ Id1: string; Canonical_Name: string }> = [];
      let page = 1;
      while (true) {
        const res = await fetch(`/api/browse?page=${page}&limit=200&sort=name_asc`, { credentials: 'include' });
        if (!res.ok) break;
        const data = await res.json();
        for (const p of data.plants) all.push({ Id1: (p as any).Id1 || p.Id, Canonical_Name: p.Canonical_Name });
        if (data.pageInfo?.isLastPage || data.plants.length === 0) break;
        page++;
      }
      setAllPlants(all);
    }
    fetchPlantList();
  }, []);

  const plantNav = useMemo(() => {
    if (!id || allPlants.length === 0) return { prev: null, next: null, currentIdx: -1 };
    const idx = allPlants.findIndex(p => p.Id1 === id);
    return {
      prev: idx > 0 ? allPlants[idx - 1] : null,
      next: idx < allPlants.length - 1 ? allPlants[idx + 1] : null,
      currentIdx: idx,
    };
  }, [id, allPlants]);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  const handleDeletePlant = useCallback(async () => {
    if (!id) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/browse/plant/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success(`Deleted "${detail?.plant?.Canonical_Name ?? id}"`);
        navigate('/plants', { replace: true });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [id, detail, navigate]);

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

  // Turn off edit mode when switching away from overview
  useEffect(() => {
    if (activeTab !== 'overview' && editMode) setEditMode(false);
  }, [activeTab, editMode]);

  const handlePlantUpdated = (plant: BrowsePlant) => {
    if (!detail) return;
    // Merge rather than replace so enriched fields (hero_image, hero_rotation)
    // aren't lost if the response doesn't include them
    setDetail({ ...detail, plant: { ...detail.plant, ...plant } });
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
        backTo="/plants"
        backLabel="Back to Plants"
        titleClassName="text-xl"
        headerCenter={allPlants.length > 0 ? (
          <div className="flex items-center gap-2">
            {plantNav.prev ? (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
                onClick={() => navigate(`/plants/${plantNav.prev!.Id1}`)}
                title={`Previous: ${plantNav.prev.Canonical_Name}`}
              >
                &larr; {plantNav.prev.Canonical_Name}
              </button>
            ) : <span className="w-[120px]" />}

            <Select value={id} onValueChange={(slug) => navigate(`/plants/${slug}`)}>
              <SelectTrigger className="h-7 text-xs w-[160px] text-center">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {allPlants.map(p => (
                  <SelectItem key={p.Id1} value={p.Id1} className="text-xs">
                    {p.Canonical_Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {plantNav.next ? (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
                onClick={() => navigate(`/plants/${plantNav.next!.Id1}`)}
                title={`Next: ${plantNav.next.Canonical_Name}`}
              >
                {plantNav.next.Canonical_Name} &rarr;
              </button>
            ) : <span className="w-[120px]" />}
          </div>
        ) : undefined}
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-0">
            {/* Sticky tabs bar */}
            <div className="sticky top-14 z-30 bg-background border-b">
              <TabsList className="w-full overflow-x-auto flex-nowrap px-4">
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
            </div>

            <div className="p-4">
              <TabsContent value="overview" className="mt-0" forceMount>
                {/* Edit/Save/Delete — only on Overview, below tabs */}
                {isAdmin && (
                  <div className="flex items-center gap-2 mb-4">
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
                    {editMode && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        Delete Plant
                      </Button>
                    )}
                  </div>
                )}
                <OverviewTab
                  plant={detail.plant}
                  imageCount={detail.images?.pageInfo?.totalRows ?? detail.images?.list?.length ?? 0}
                  varietyCount={detail.varieties.length}
                  documentCount={detail.documents.length}
                  attachmentCount={detail.attachments?.length ?? 0}
                  recipeCount={detail.recipes.length}
                  editMode={editMode}
                  onPlantUpdated={handlePlantUpdated}
                  onSlugChanged={(newSlug) => navigate(`/plants/${newSlug}`, { replace: true })}
                  saveRef={overviewSaveRef}
                />
              </TabsContent>

              <TabsContent value="gallery" className="mt-0" forceMount>
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

              <TabsContent value="varieties" className="mt-0" forceMount>
                <VarietiesTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  varieties={detail.varieties}
                  editMode={editMode}
                  onVarietiesChanged={handleVarietiesChanged}
                />
              </TabsContent>

              <TabsContent value="nutrition" className="mt-0" forceMount>
                <NutritionTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  nutritional={detail.nutritional}
                  editMode={editMode}
                  onNutritionalChanged={handleNutritionalChanged}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-0" forceMount>
                <DocumentsTab documents={detail.documents} />
              </TabsContent>

              <TabsContent value="attachments" className="mt-0" forceMount>
                <AttachmentsTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  attachments={detail.attachments ?? []}
                  editMode={editMode}
                />
              </TabsContent>

              <TabsContent value="recipes" className="mt-0" forceMount>
                <RecipesTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  recipes={detail.recipes}
                  onRecipesChanged={(recipes) => setDetail(prev => prev ? { ...prev, recipes } : prev)}
                />
              </TabsContent>

              <TabsContent value="ocr" className="mt-0" forceMount>
                <OcrTab ocrExtractions={detail.ocr} plantId={(detail.plant as any).Id1 || detail.plant.Id} />
              </TabsContent>

              <TabsContent value="notes" className="mt-0" forceMount>
                <NotesTab
                  plantId={(detail.plant as any).Id1 || detail.plant.Id}
                  notes={detail.notes}
                  varieties={detail.varieties}
                  onNotesChanged={handleNotesChanged}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}

        {!isLoading && !detail && (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <p className="text-lg text-muted-foreground">Plant not found</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/plants')}>
              Back to Plants
            </Button>
          </div>
        )}
        {/* Delete confirmation dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent className="max-w-sm">
            <DialogTitle>Delete Plant</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{detail?.plant?.Canonical_Name}</strong>? This will remove all associated varieties, images, nutritional info, and growing notes. Documents and recipes will have this plant removed from their associations.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeletePlant} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AuthGuard>
  );
}
