import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import * as dal from '../lib/dal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ── GET /api/plants?search= ───────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { search } = req.query;

  if (search && typeof search === 'string' && search.length >= 2) {
    const plants = dal.searchPlants(search);
    res.json({ plants });
  } else if (!search) {
    const plants = dal.getAllPlants();
    res.json({ plants });
  } else {
    res.json({ plants: [] }); // search query too short (< 2 chars)
  }
});

// ── GET /api/plants/csv-candidates?search= ────────────────────────────────────
// IMPORTANT: This route must come BEFORE /:id/reference-images to avoid being
// matched by the :id param route
router.get('/csv-candidates', (req, res) => {
  const candidatesPath = path.join(__dirname, '..', 'data', 'csv-candidates.json');

  if (!fs.existsSync(candidatesPath)) {
    res.json({ candidates: [] });
    return;
  }

  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const { search } = req.query;

  if (search && typeof search === 'string' && search.length >= 1) {
    const q = search.toLowerCase();
    const filtered = candidates.filter((c: any) =>
      (c.common_name ?? c.fruit_type ?? '').toLowerCase().includes(q) ||
      (c.scientific_name ?? '').toLowerCase().includes(q)
    );
    res.json({ candidates: filtered });
  } else {
    res.json({ candidates });
  }
});

// ── GET /api/plants/:id/reference-images ─────────────────────────────────────
router.get('/:id/reference-images', (req, res) => {
  const { id } = req.params;

  // Plant images are stored at IMAGE_MOUNT_PATH/plants/{id}/images/
  const plantImagesDir = path.join(config.IMAGE_MOUNT_PATH, 'plants', id, 'images');

  if (!fs.existsSync(plantImagesDir)) {
    res.json({ images: [] });
    return;
  }

  const allFiles = fs.readdirSync(plantImagesDir)
    .filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));

  // Fisher-Yates shuffle
  for (let i = allFiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allFiles[i], allFiles[j]] = [allFiles[j], allFiles[i]];
  }

  const selected = allFiles.slice(0, 6);
  const images = selected.map(filename => {
    const relativePath = `plants/${id}/images/${filename}`;
    return {
      path: `/images/${relativePath}`,
      thumbnail: `/thumbnails/${relativePath}`,
    };
  });

  res.json({ images });
});

// ── POST /api/plants/new ──────────────────────────────────────────────────────
router.post('/new', (req, res) => {
  const { common_name, botanical_name, category, aliases } = req.body ?? {};

  if (!common_name) {
    res.status(400).json({ error: 'common_name is required' });
    return;
  }

  // Check for duplicates (case-insensitive)
  const existing = dal.searchPlants(common_name).find(
    p => p.common_name.toLowerCase() === common_name.toLowerCase()
  );
  if (existing) {
    res.status(409).json({ error: 'A plant with this name already exists', plant: existing });
    return;
  }

  const plant = dal.createNewPlantRequest({
    common_name,
    botanical_name: botanical_name || undefined,
    category: category || 'fruit',
    aliases: aliases || undefined,
    requested_by: req.user!.id,
  });

  res.status(201).json({ plant });
});

export default router;
