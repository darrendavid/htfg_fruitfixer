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

  // Enrich each plant with a hero image path by checking the filesystem
  const enrichedPlants = result.list.map((plant: any) => {
    const slug = plant.Id1;
    if (slug && plant.Image_Count > 0) {
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
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const offset = (page - 1) * limit;

  const result = await nocodb.list('Images', {
    where: `(Plant_Id,eq,${plantId})`,
    limit,
    offset,
  });

  res.json({
    list: result.list,
    pageInfo: result.pageInfo,
  });
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

  const [varieties, nutritional, images, documents, recipes, ocr] = await Promise.all([
    nocodb.list('Varieties', { where: `(Plant_Id,eq,${plantSlug})`, limit: 200 }).catch(() => ({ list: [] })),
    nocodb.list('Nutritional_Info', { where: `(Plant_Id,eq,${plantSlug})`, limit: 200 }).catch(() => ({ list: [] })),
    nocodb.list('Images', { where: `(Plant_Id,eq,${plantSlug})`, limit: imageLimit, offset: imageOffset }).catch(() => ({ list: [], pageInfo: {} })),
    nocodb.list('Documents', { where: `(Plant_Ids,like,%${plantSlug}%)`, limit: 100 }).catch(() => ({ list: [] })),
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

  // Add hero_image to plant
  if (plantSlug) {
    try {
      const plantDir = path.join(config.IMAGE_MOUNT_PATH, 'plants', plantSlug, 'images');
      const files = readdirSync(plantDir).filter((f: string) => /\.(jpe?g|png|gif)$/i.test(f));
      if (files.length > 0) {
        plant.hero_image = `plants/${plantSlug}/images/${files[0]}`;
      }
    } catch { /* no directory */ }
  }

  res.json({
    plant,
    varieties: varieties.list,
    nutritional: nutritional.list,
    images: { list: (images as any).list, pageInfo: (images as any).pageInfo },
    documents: documents.list,
    recipes: recipes.list,
    ocr: ocr.list,
    notes,
  });
}));

// ── PATCH /:id — Update plant (admin) ────────────────────────────────────────
router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowed = ['Canonical_Name', 'Botanical_Name', 'Aliases', 'Description', 'Category'];
  const fields: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }

  if (Object.keys(fields).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' });
    return;
  }

  await nocodb.update('Plants', id, fields);
  const updated = await nocodb.get('Plants', id);
  res.json(updated);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// VARIETY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

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

// ── POST /exclude-image/:id — Exclude image and prevent re-import (admin) ────
router.post('/exclude-image/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await nocodb.update('Images', id, { Excluded: true, Needs_Review: false });
  res.json({ success: true });
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
