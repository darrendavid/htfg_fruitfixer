import { Router, type Request, type Response } from 'express';
import path from 'path';
import { readdirSync } from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { nocodb, type ListOptions } from '../lib/nocodb.js';
import { config } from '../config.js';
import db from '../lib/db.js';

const router = Router();

// ── Helper: async route wrapper ──────────────────────────────────────────────
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: Function) => {
    fn(req, res).catch(next);
  };
}

// ── Helper: collect plant IDs from a NocoDB list result ──────────────────────
function extractPlantIds(list: Record<string, any>[], field: string): string[] {
  const ids = new Set<string>();
  for (const row of list) {
    const val = row[field];
    if (!val) continue;
    // Field may be a single ID or comma-separated list
    const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) ids.add(p);
  }
  return [...ids];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET / — List plants ──────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const sort = (req.query.sort as string) || 'Canonical_Name';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
  const offset = (page - 1) * limit;

  // Build sort param
  let nocodbSort = 'Canonical_Name';
  if (sort === 'name') nocodbSort = 'Canonical_Name';
  else if (sort === '-name') nocodbSort = '-Canonical_Name';
  else if (sort === 'images') nocodbSort = '-Image_Count';

  // Build where clause parts
  const whereParts: string[] = [];

  if (category) {
    whereParts.push(`(Category,eq,${category})`);
  }

  // Collect plant IDs from cross-table search
  let crossTablePlantIds: Set<string> | null = null;

  if (search) {
    // Search Plants table fields directly
    const plantSearchParts = [
      `(Canonical_Name,like,%${search}%)`,
      `(Botanical_Name,like,%${search}%)`,
      `(Aliases,like,%${search}%)`,
    ];
    const plantWhere = plantSearchParts.join('~or');

    // Also search related tables for matching plant IDs
    crossTablePlantIds = new Set<string>();

    const [docResults, recipeResults, ocrResults, varietyResults] = await Promise.all([
      nocodb.list('Documents', { where: `(Content_Text,like,%${search}%)`, fields: ['Plant_Ids'], limit: 100 }).catch(() => ({ list: [] })),
      nocodb.list('Recipes', { where: `(Title,like,%${search}%)~or(Ingredients,like,%${search}%)`, fields: ['Plant_Ids'], limit: 100 }).catch(() => ({ list: [] })),
      nocodb.list('OCR_Extractions', { where: `(Extracted_Text,like,%${search}%)`, fields: ['Plant_Ids'], limit: 100 }).catch(() => ({ list: [] })),
      nocodb.list('Varieties', { where: `(Variety_Name,like,%${search}%)`, fields: ['Plant_Id'], limit: 100 }).catch(() => ({ list: [] })),
    ]);

    for (const id of extractPlantIds(docResults.list, 'Plant_Ids')) crossTablePlantIds.add(id);
    for (const id of extractPlantIds(recipeResults.list, 'Plant_Ids')) crossTablePlantIds.add(id);
    for (const id of extractPlantIds(ocrResults.list, 'Plant_Ids')) crossTablePlantIds.add(id);
    for (const id of extractPlantIds(varietyResults.list, 'Plant_Id')) crossTablePlantIds.add(id);

    if (crossTablePlantIds.size > 0) {
      // Combine: match plants by name OR by cross-table IDs
      const idConditions = [...crossTablePlantIds].map(id => `(Id,eq,${id})`).join('~or');
      whereParts.push(`(${plantWhere}~or${idConditions})`);
    } else {
      whereParts.push(`(${plantWhere})`);
    }
  }

  const listOpts: ListOptions = {
    sort: nocodbSort,
    limit,
    offset,
  };
  if (whereParts.length > 0) {
    listOpts.where = whereParts.join('~and');
  }

  const result = await nocodb.list('Plants', listOpts);

  // Enrich each plant with a hero image path
  // Check hero_images table first (user-selected), fall back to filesystem
  const heroRows = db.prepare(`SELECT plant_id, file_path FROM hero_images`).all() as Array<{ plant_id: string; file_path: string }>;
  const heroMap = new Map(heroRows.map((r) => [r.plant_id, r.file_path]));

  const enrichedPlants = result.list.map((plant: any) => {
    const slug = plant.Id1;
    if (!slug) return plant;

    // Check for user-selected hero
    const heroPath = heroMap.get(slug);
    if (heroPath) {
      plant.hero_image = heroPath.replace(/^content\/parsed\//, '');
      return plant;
    }

    // Fall back to first image on disk
    if (plant.Image_Count > 0) {
      try {
        const plantDir = path.join(config.IMAGE_MOUNT_PATH, 'plants', slug, 'images');
        const files = readdirSync(plantDir).filter((f: string) => /\.(jpe?g|png|gif)$/i.test(f));
        if (files.length > 0) {
          plant.hero_image = `plants/${slug}/images/${files[0]}`;
        }
      } catch { /* no directory */ }
    }
    return plant;
  });

  res.json({
    plants: enrichedPlants,
    pageInfo: result.pageInfo,
  });
}));

// ── GET /search — Full-text search across all tables ─────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q) {
    res.json({ plants: [], varieties: [], documents: [], recipes: [], ocr: [] });
    return;
  }

  const [plants, varieties, documents, recipes, ocr] = await Promise.all([
    nocodb.list('Plants', {
      where: `(Canonical_Name,like,%${q}%)~or(Botanical_Name,like,%${q}%)~or(Aliases,like,%${q}%)`,
      limit: 20,
    }).catch(() => ({ list: [] })),
    nocodb.list('Varieties', {
      where: `(Variety_Name,like,%${q}%)`,
      limit: 20,
    }).catch(() => ({ list: [] })),
    nocodb.list('Documents', {
      where: `(Content_Text,like,%${q}%)~or(Title,like,%${q}%)`,
      limit: 20,
    }).catch(() => ({ list: [] })),
    nocodb.list('Recipes', {
      where: `(Title,like,%${q}%)~or(Ingredients,like,%${q}%)`,
      limit: 20,
    }).catch(() => ({ list: [] })),
    nocodb.list('OCR_Extractions', {
      where: `(Extracted_Text,like,%${q}%)`,
      limit: 20,
    }).catch(() => ({ list: [] })),
  ]);

  res.json({
    plants: plants.list,
    varieties: varieties.list,
    documents: documents.list,
    recipes: recipes.list,
    ocr: ocr.list,
  });
}));

// ── GET /:plantId/images — Paginated images for a plant ─────────────────────
router.get('/:plantId/images', asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const all = req.query.all === 'true';
  const showDeleted = req.query.showDeleted === 'true';
  const excludeFilter = showDeleted ? '' : '~and(Excluded,neq,1)';
  const where = `(Plant_Id,eq,${plantId})${excludeFilter}`;

  if (all) {
    const allImages: any[] = [];
    let offset = 0;
    while (true) {
      const result = await nocodb.list('Images', { where, limit: 200, offset });
      allImages.push(...result.list);
      if (result.pageInfo.isLastPage) break;
      offset += 200;
    }
    res.json({ list: allImages, pageInfo: { totalRows: allImages.length } });
  } else {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const offset = (page - 1) * limit;
    const result = await nocodb.list('Images', { where, limit, offset });
    res.json({ list: result.list, pageInfo: result.pageInfo });
  }
}));

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACHMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── PATCH /attachments/:id — Update attachment (admin) ────────────────────────
router.patch('/attachments/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Attachments', id, req.body);
  const updated = await nocodb.get('Attachments', id);
  res.json(updated);
}));

// ── DELETE /attachments/:id — Delete attachment (admin) ───────────────────────
router.delete('/attachments/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.delete('Attachments', id);
  res.json({ success: true });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT CRUD ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── PATCH /documents/:id — Update document (admin) ───────────────────────────
router.patch('/documents/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Documents', id, req.body);
  const updated = await nocodb.get('Documents', id);
  res.json(updated);
}));

// ── DELETE /documents/:id — Delete document (admin) ──────────────────────────
router.delete('/documents/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.delete('Documents', id);
  res.json({ success: true });
}));

// ── GET /:plantId/attachments — List attachments for a plant ─────────────────
router.get('/:plantId/attachments', asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const result = await nocodb.list('Attachments', {
    where: `(Plant_Ids,like,%${plantId}%)`,
    limit: 200,
  });
  res.json(result.list);
}));

// ── POST /:plantId/attachments — Create attachment (admin) ───────────────────
router.post('/:plantId/attachments', requireAdmin, asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const { Title, File_Path, File_Name, File_Type, File_Size, Description } = req.body;
  const existing = req.body.Plant_Ids ? JSON.parse(req.body.Plant_Ids) : [];
  if (!existing.includes(plantId)) existing.push(plantId);
  const result = await nocodb.create('Attachments', {
    Title,
    File_Path,
    File_Name: File_Name || File_Path?.split('/').pop(),
    File_Type,
    File_Size: File_Size || 0,
    Plant_Ids: JSON.stringify(existing),
    Description: Description || null,
  });
  res.status(201).json(result);
}));

// ── POST /create-plant — Create a new plant (admin) ──────────────────────────
router.post('/create-plant', requireAdmin, asyncHandler(async (req, res) => {
  const { Canonical_Name, Id1, Category } = req.body ?? {};
  if (!Canonical_Name) { res.status(400).json({ error: 'Canonical_Name required' }); return; }
  const slug = Id1 || Canonical_Name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const result = await nocodb.create('Plants', {
    Id1: slug,
    Canonical_Name,
    Category: Category || 'fruit',
    Image_Count: 0,
    Source_Count: 0,
  });
  res.status(201).json(result);
}));

// ── GET /plants-search — Search all plants by name (for reassignment) ────────
router.get('/plants-search', asyncHandler(async (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) { res.json([]); return; }
  const result = await nocodb.list('Plants', {
    where: `(Canonical_Name,like,%${q}%)`,
    limit: 15,
    sort: 'Canonical_Name',
    fields: ['Id', 'Id1', 'Canonical_Name', 'Category'],
  });
  res.json(result.list);
}));

// ── GET /:id — Full plant detail ─────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // id can be NocoDB row ID (number) or plant slug (text)
  let plant: any;
  const numId = parseInt(id, 10);
  if (!isNaN(numId) && String(numId) === id) {
    // Numeric ID — fetch by NocoDB row ID
    plant = await nocodb.get('Plants', id).catch(() => null);
  } else {
    // Text slug — search by Id1 field
    const result = await nocodb.list('Plants', { where: `(Id1,eq,${id})`, limit: 1 }).catch(() => ({ list: [] }));
    plant = result.list?.[0] || null;
  }

  if (!plant) {
    res.status(404).json({ error: 'Plant not found' });
    return;
  }

  // Use the text slug (Id1) for cross-table queries
  const plantSlug = plant.Id1 || id;

  const imageLimit = Math.min(200, Math.max(1, parseInt(req.query.imageLimit as string) || 50));
  const imageOffset = Math.max(0, parseInt(req.query.imageOffset as string) || 0);

  const [varieties, nutritional, images, documents, attachments, recipes, ocr] = await Promise.all([
    nocodb.list('Varieties', { where: `(Plant_Id,eq,${plantSlug})`, limit: 200 }).catch(() => ({ list: [] })),
    nocodb.list('Nutritional_Info', { where: `(Plant_Id,eq,${plantSlug})`, limit: 200 }).catch(() => ({ list: [] })),
    nocodb.list('Images', { where: `(Plant_Id,eq,${plantSlug})~and(Excluded,neq,1)`, limit: imageLimit, offset: imageOffset }).catch(() => ({ list: [], pageInfo: {} })),
    nocodb.list('Documents', { where: `(Plant_Ids,like,%${plantSlug}%)`, limit: 100 }).catch(() => ({ list: [] })),
    nocodb.list('Attachments', { where: `(Plant_Ids,like,%${plantSlug}%)`, limit: 200 }).catch(() => ({ list: [] })),
    nocodb.list('Recipes', { where: `(Plant_Ids,like,%${plantSlug}%)`, limit: 100 }).catch(() => ({ list: [] })),
    nocodb.list('OCR_Extractions', { where: `(Plant_Ids,like,%${plantSlug}%)`, limit: 100 }).catch(() => ({ list: [] })),
  ]);

  // Get staff notes from local SQLite
  const notes = db.prepare(`
    SELECT sn.*, u.first_name, u.last_name
    FROM staff_notes sn
    JOIN users u ON sn.user_id = u.id
    WHERE sn.plant_id = ?
    ORDER BY sn.created_at DESC
  `).all(plantSlug);

  // Add hero_image to plant — check hero_images table first, then filesystem
  if (plantSlug) {
    const heroRow = db.prepare(`SELECT file_path FROM hero_images WHERE plant_id = ?`).get(plantSlug) as { file_path: string } | undefined;
    if (heroRow) {
      plant.hero_image = heroRow.file_path.replace(/^content\/parsed\//, '');
    } else {
      try {
        const plantDir = path.join(config.IMAGE_MOUNT_PATH, 'plants', plantSlug, 'images');
        const files = readdirSync(plantDir).filter((f: string) => /\.(jpe?g|png|gif)$/i.test(f));
        if (files.length > 0) {
          plant.hero_image = `plants/${plantSlug}/images/${files[0]}`;
        }
      } catch { /* no directory */ }
    }
  }

  res.json({
    plant,
    varieties: varieties.list,
    nutritional: nutritional.list,
    images: { list: (images as any).list, pageInfo: (images as any).pageInfo },
    documents: documents.list,
    attachments: attachments.list,
    recipes: recipes.list,
    ocr: ocr.list,
    notes,
  });
}));

// ── PATCH /:id — Update plant (admin) ────────────────────────────────────────
router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'Canonical_Name', 'Botanical_Name', 'Aliases', 'Description', 'Category',
    'Alternative_Names', 'Origin', 'Flower_Colors', 'Elevation_Range',
    'Distribution', 'Culinary_Regions', 'Primary_Use',
    'Total_Varieties', 'Classification_Methods', 'Parent_Species',
    'Chromosome_Groups', 'Genetic_Contribution',
  ];
  const fields: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }

  if (Object.keys(fields).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' });
    return;
  }

  // Resolve slug to numeric ID if needed
  let current: any;
  const numId = parseInt(id, 10);
  if (!isNaN(numId) && String(numId) === id) {
    current = await nocodb.get('Plants', id);
  } else {
    const result = await nocodb.list('Plants', { where: `(Id1,eq,${id})`, limit: 1 });
    current = result.list?.[0];
    if (!current) { res.status(404).json({ error: 'Plant not found' }); return; }
  }
  const rowId = current.Id;
  const oldSlug = current.Id1;

  if (fields.Canonical_Name && fields.Canonical_Name !== current.Canonical_Name) {
    const newSlug = fields.Canonical_Name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    fields.Id1 = newSlug;

    // Cascade slug change across all related tables
    const tablesToUpdate: Array<{ table: string; field: string; isJson: boolean }> = [
      { table: 'Varieties', field: 'Plant_Id', isJson: false },
      { table: 'Images', field: 'Plant_Id', isJson: false },
      { table: 'Nutritional_Info', field: 'Plant_Id', isJson: false },
      { table: 'Growing_Notes', field: 'Plant_Id', isJson: false },
    ];

    const jsonTablesToUpdate: Array<{ table: string; field: string }> = [
      { table: 'Documents', field: 'Plant_Ids' },
      { table: 'Recipes', field: 'Plant_Ids' },
      { table: 'OCR_Extractions', field: 'Plant_Ids' },
      { table: 'Attachments', field: 'Plant_Ids' },
    ];

    // Update simple Plant_Id fields
    for (const { table, field } of tablesToUpdate) {
      try {
        const records = await nocodb.list(table, { where: `(${field},eq,${oldSlug})`, limit: 1000 });
        if (records.list.length > 0) {
          const updates = records.list.map((r: any) => ({ Id: r.Id, [field]: newSlug }));
          for (let i = 0; i < updates.length; i += 100) {
            await nocodb.bulkUpdate(table, updates.slice(i, i + 100));
          }
        }
      } catch { /* table may not have records */ }
    }

    // Update JSON array Plant_Ids fields
    for (const { table, field } of jsonTablesToUpdate) {
      try {
        const records = await nocodb.list(table, { where: `(${field},like,%${oldSlug}%)`, limit: 1000 });
        if (records.list.length > 0) {
          const updates = records.list
            .map((r: any) => {
              try {
                const ids: string[] = JSON.parse(r[field] || '[]');
                const idx = ids.indexOf(oldSlug);
                if (idx >= 0) {
                  ids[idx] = newSlug;
                  return { Id: r.Id, [field]: JSON.stringify(ids) };
                }
              } catch { /* not valid JSON */ }
              return null;
            })
            .filter(Boolean) as any[];
          for (let i = 0; i < updates.length; i += 100) {
            await nocodb.bulkUpdate(table, updates.slice(i, i + 100));
          }
        }
      } catch { /* table may not have records */ }
    }

    // Update local SQLite references
    db.prepare(`UPDATE hero_images SET plant_id = ? WHERE plant_id = ?`).run(newSlug, oldSlug);
    db.prepare(`UPDATE staff_notes SET plant_id = ? WHERE plant_id = ?`).run(newSlug, oldSlug);
  }

  await nocodb.update('Plants', rowId, fields);
  const updated = await nocodb.get('Plants', rowId);
  res.json(updated);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// VARIETY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /:plantId/varieties-search — Search varieties for a plant ─────────────
router.get('/:plantId/varieties-search', asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const q = (req.query.q as string || '').trim();
  if (!q) { res.json([]); return; }
  const result = await nocodb.list('Varieties', {
    where: `(Plant_Id,eq,${plantId})~and(Variety_Name,like,%${q}%)`,
    limit: 20,
    sort: 'Variety_Name',
  });
  res.json(result.list);
}));

// ── POST /:plantId/varieties — Create variety (admin) ────────────────────────
router.post('/:plantId/varieties', requireAdmin, asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const data = { ...req.body, Plant_Id: plantId };
  const result = await nocodb.create('Varieties', data);
  res.status(201).json(result);
}));

// ── PATCH /varieties/:id — Update variety (admin) ────────────────────────────
router.patch('/varieties/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Varieties', id, req.body);
  const updated = await nocodb.get('Varieties', id);
  res.json(updated);
}));

// ── DELETE /varieties/:id — Delete variety (admin) ───────────────────────────
router.delete('/varieties/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.delete('Varieties', id);
  res.json({ success: true });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// NUTRITIONAL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /:plantId/nutritional — Create nutrient record (admin) ──────────────
router.post('/:plantId/nutritional', requireAdmin, asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const data = { ...req.body, Plant_Id: plantId };
  const result = await nocodb.create('Nutritional_Info', data);
  res.status(201).json(result);
}));

// ── PATCH /nutritional/:id — Update nutrient record (admin) ──────────────────
router.patch('/nutritional/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Nutritional_Info', id, req.body);
  const updated = await nocodb.get('Nutritional_Info', id);
  res.json(updated);
}));

// ── DELETE /nutritional/:id — Delete nutrient record (admin) ─────────────────
router.delete('/nutritional/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.delete('Nutritional_Info', id);
  res.json({ success: true });
}));

// ── POST /set-hero/:imageId — Set an image as the hero for its plant (admin) ──
router.post('/set-hero/:imageId', requireAdmin, asyncHandler(async (req, res) => {
  const { imageId } = req.params;
  const { plant_id } = req.body ?? {};
  if (!plant_id) {
    res.status(400).json({ error: 'plant_id is required' });
    return;
  }

  // Get the image record to find its file path
  const image = await nocodb.get('Images', imageId);
  if (!image) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  // Store hero preference in local SQLite (simple key-value)
  db.prepare(`
    INSERT OR REPLACE INTO hero_images (plant_id, image_id, file_path)
    VALUES (?, ?, ?)
  `).run(plant_id, imageId, image.File_Path);

  res.json({ success: true, file_path: image.File_Path });
}));

// ── POST /reassign-image/:id — Move image to a different plant (admin) ────────
router.post('/reassign-image/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plant_id } = req.body ?? {};
  if (!plant_id) { res.status(400).json({ error: 'plant_id required' }); return; }
  await nocodb.update('Images', id, { Plant_Id: plant_id });
  res.json({ success: true, plant_id });
}));


// ── PATCH /ocr-extractions/:id — Update an OCR extraction (admin) ─────────────
router.patch('/ocr-extractions/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('OCR_Extractions', id, req.body);
  const updated = await nocodb.get('OCR_Extractions', id);
  res.json(updated);
}));

// ── DELETE /ocr-extractions/:id — Delete an OCR extraction (admin) ────────────
router.delete('/ocr-extractions/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.delete('OCR_Extractions', id);
  res.json({ success: true });
}));

// ── POST /bulk-reassign-images — Reassign multiple images to a plant (admin) ──
router.post('/bulk-reassign-images', requireAdmin, asyncHandler(async (req, res) => {
  const { image_ids, plant_id } = req.body ?? {};
  if (!image_ids?.length || !plant_id) { res.status(400).json({ error: 'image_ids[] and plant_id required' }); return; }
  const updates = image_ids.map((id: number) => ({ Id: id, Plant_Id: plant_id }));
  for (let i = 0; i < updates.length; i += 100) {
    await nocodb.bulkUpdate('Images', updates.slice(i, i + 100));
  }
  res.json({ success: true, count: image_ids.length });
}));

// ── POST /bulk-set-variety — Set variety on multiple images (admin) ───────────
router.post('/bulk-set-variety', requireAdmin, asyncHandler(async (req, res) => {
  const { image_ids, variety_name } = req.body ?? {};
  if (!image_ids?.length) { res.status(400).json({ error: 'image_ids[] required' }); return; }
  const updates = image_ids.map((id: number) => ({ Id: id, Variety_Name: variety_name || null }));
  for (let i = 0; i < updates.length; i += 100) {
    await nocodb.bulkUpdate('Images', updates.slice(i, i + 100));
  }
  res.json({ success: true, count: image_ids.length });
}));

// ── POST /set-image-variety/:id — Assign a variety to an image (admin) ────────
router.post('/set-image-variety/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { variety_name } = req.body ?? {};
  await nocodb.update('Images', id, { Variety_Name: variety_name || null });
  res.json({ success: true, variety_name: variety_name || null });
}));

// ── POST /rotate-image/:id — Set rotation for an image (admin) ───────────────
router.post('/rotate-image/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rotation } = req.body ?? {};
  const deg = ((rotation ?? 0) % 360 + 360) % 360;
  await nocodb.update('Images', id, { Rotation: deg });
  res.json({ success: true, rotation: deg });
}));

// ── POST /restore-image/:id — Restore an excluded image (admin) ──────────────
router.post('/restore-image/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Images', id, { Excluded: false });
  res.json({ success: true });
}));

// ── POST /exclude-image/:id — Exclude image and prevent re-import (admin) ────
router.post('/exclude-image/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Images', id, { Excluded: true, Needs_Review: false });
  res.json({ success: true });
}));

// ── POST /image-to-attachment/:id — Move image to Attachments table (admin) ──
router.post('/image-to-attachment/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const image = await nocodb.get('Images', id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  const title = req.body.title || image.Caption || path.basename(image.File_Path).replace(/\.\w+$/, '');
  const plantIds = image.Plant_Id ? JSON.stringify([image.Plant_Id]) : null;
  const fileName = path.basename(image.File_Path);
  const ext = path.extname(fileName).replace('.', '').toLowerCase();

  // Create attachment record
  const attachment = await nocodb.create('Attachments', {
    Title: title,
    File_Path: image.File_Path,
    File_Name: fileName,
    File_Type: ext || 'jpg',
    File_Size: image.Size_Bytes || 0,
    Plant_Ids: plantIds,
    Description: null,
  });

  // Exclude image from gallery
  await nocodb.update('Images', id, { Excluded: true, Needs_Review: false });

  res.json({ success: true, attachment });
}));

// ── POST /reassign-document/:id — Move document to a different plant (admin) ──
router.post('/reassign-document/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plant_id } = req.body ?? {};
  if (!plant_id) { res.status(400).json({ error: 'plant_id required' }); return; }
  await nocodb.update('Documents', id, { Plant_Ids: JSON.stringify([plant_id]), Is_Plant_Related: true });
  res.json({ success: true, plant_id });
}));

// ── POST /reassign-attachment/:id — Move attachment to a different plant (admin)
router.post('/reassign-attachment/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plant_id } = req.body ?? {};
  if (!plant_id) { res.status(400).json({ error: 'plant_id required' }); return; }
  await nocodb.update('Attachments', id, { Plant_Ids: JSON.stringify([plant_id]) });
  res.json({ success: true, plant_id });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES ENDPOINTS (local SQLite)
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /:plantId/notes — List notes for plant ───────────────────────────────
router.get('/:plantId/notes', (req, res) => {
  const { plantId } = req.params;
  const varietyId = req.query.variety_id as string | undefined;

  let sql = `
    SELECT sn.*, u.first_name, u.last_name
    FROM staff_notes sn
    JOIN users u ON sn.user_id = u.id
    WHERE sn.plant_id = ?
  `;
  const params: any[] = [plantId];

  if (varietyId) {
    sql += ' AND sn.variety_id = ?';
    params.push(parseInt(varietyId, 10));
  }

  sql += ' ORDER BY sn.created_at DESC';

  const notes = db.prepare(sql).all(...params);
  res.json({ notes });
});

// ── POST /:plantId/notes — Add note (any auth'd user) ───────────────────────
router.post('/:plantId/notes', (req, res) => {
  const { plantId } = req.params;
  const { text, variety_id } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO staff_notes (plant_id, variety_id, user_id, text)
    VALUES (?, ?, ?, ?)
  `).run(plantId, variety_id ?? null, req.user!.id, text.trim());

  const note = db.prepare(`
    SELECT sn.*, u.first_name, u.last_name
    FROM staff_notes sn
    JOIN users u ON sn.user_id = u.id
    WHERE sn.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(note);
});

// ── PATCH /notes/:id — Update own note ───────────────────────────────────────
router.patch('/notes/:id', (req, res) => {
  const { id } = req.params;
  const { text } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const existing = db.prepare('SELECT * FROM staff_notes WHERE id = ?').get(parseInt(id, 10)) as any;
  if (!existing) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }

  if (existing.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'You can only edit your own notes' });
    return;
  }

  db.prepare(`
    UPDATE staff_notes SET text = ?, updated_at = datetime('now') WHERE id = ?
  `).run(text.trim(), parseInt(id, 10));

  const updated = db.prepare(`
    SELECT sn.*, u.first_name, u.last_name
    FROM staff_notes sn
    JOIN users u ON sn.user_id = u.id
    WHERE sn.id = ?
  `).get(parseInt(id, 10));

  res.json(updated);
});

// ── DELETE /notes/:id — Delete own note (or admin can delete any) ────────────
router.delete('/notes/:id', (req, res) => {
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM staff_notes WHERE id = ?').get(parseInt(id, 10)) as any;
  if (!existing) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }

  if (existing.user_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'You can only delete your own notes' });
    return;
  }

  db.prepare('DELETE FROM staff_notes WHERE id = ?').run(parseInt(id, 10));
  res.json({ success: true });
});

export default router;
