import { Router } from 'express';
import db from '../lib/db.js';
import * as dal from '../lib/dal.js';

const router = Router();

const VALID_DISCARD_CATEGORIES = new Set(['event', 'graphics', 'travel', 'duplicate', 'poor_quality']);

// ── POST /api/review/confirm ──────────────────────────────────────────────────
router.post('/confirm', (req, res) => {
  const { image_path } = req.body ?? {};
  if (!image_path) {
    res.status(400).json({ error: 'image_path is required' });
    return;
  }

  try {
    dal.confirmItem(image_path, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Item not found' });
  }
});

// ── POST /api/review/reject ───────────────────────────────────────────────────
router.post('/reject', (req, res) => {
  const { image_path } = req.body ?? {};
  if (!image_path) {
    res.status(400).json({ error: 'image_path is required' });
    return;
  }

  try {
    dal.rejectItem(image_path, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Item not found' });
  }
});

// ── POST /api/review/classify ─────────────────────────────────────────────────
router.post('/classify', (req, res) => {
  const { image_path, plant_id } = req.body ?? {};
  if (!image_path || !plant_id) {
    res.status(400).json({ error: 'image_path and plant_id are required' });
    return;
  }

  // Verify plant_id exists in plants OR new_plant_requests
  const plantExists =
    db.prepare(`SELECT id FROM plants WHERE id = ?`).get(plant_id) ||
    db.prepare(`SELECT id FROM new_plant_requests WHERE generated_id = ?`).get(plant_id);

  if (!plantExists) {
    res.status(404).json({ error: `Plant not found: ${plant_id}` });
    return;
  }

  try {
    dal.classifyItem(image_path, plant_id, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Item not found' });
  }
});

// ── POST /api/review/discard ──────────────────────────────────────────────────
router.post('/discard', (req, res) => {
  const { image_path, category, notes } = req.body ?? {};

  if (!image_path || !category) {
    res.status(400).json({ error: 'image_path and category are required' });
    return;
  }

  if (!VALID_DISCARD_CATEGORIES.has(category)) {
    res.status(400).json({
      error: `category must be one of: ${[...VALID_DISCARD_CATEGORIES].join(', ')}`,
    });
    return;
  }

  try {
    dal.discardItem(image_path, category, notes ?? null, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Item not found' });
  }
});

// ── POST /api/review/idk ──────────────────────────────────────────────────────
router.post('/idk', (req, res) => {
  const { image_path } = req.body ?? {};
  if (!image_path) {
    res.status(400).json({ error: 'image_path is required' });
    return;
  }

  try {
    const result = dal.idkItem(image_path, req.user!.id);
    res.json({ idk_count: result.idk_count, escalated: result.escalated });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Item not found' });
  }
});

export default router;
