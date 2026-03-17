import { Router } from 'express';
import db from '../lib/db.js';
import * as dal from '../lib/dal.js';

const router = Router();

// ── GET /api/queue/next?type=swipe|classify ───────────────────────────────────
router.get('/next', (req, res) => {
  const { type } = req.query;

  if (type !== 'swipe' && type !== 'classify' && type !== 'ocr_review') {
    res.status(400).json({ error: 'type must be "swipe", "classify", or "ocr_review"' });
    return;
  }

  const userId = req.user!.id;
  const item = dal.getNextPendingItem(type, userId);

  if (!item) {
    res.json({ item: null, remaining: 0 });
    return;
  }

  // Augment with plant names
  const currentPlant = item.current_plant_id
    ? db.prepare(`SELECT common_name FROM plants WHERE id = ?`).get(item.current_plant_id) as { common_name: string } | undefined
    : undefined;

  const suggestedPlant = item.suggested_plant_id
    ? db.prepare(`SELECT common_name FROM plants WHERE id = ?`).get(item.suggested_plant_id) as { common_name: string } | undefined
    : undefined;

  const augmented = {
    ...item,
    current_plant_name: currentPlant?.common_name ?? null,
    suggested_plant_name: suggestedPlant?.common_name ?? null,
  };

  // Count remaining pending items for this queue
  const remaining = (db.prepare(`
    SELECT COUNT(*) as count FROM review_queue
    WHERE queue = ? AND status = 'pending'
  `).get(type) as { count: number }).count;

  res.json({ item: augmented, remaining });
});

// ── GET /api/queue/stats ──────────────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  const stats = dal.getQueueStats();
  res.json({ stats });
});

// ── POST /api/queue/:id/release ───────────────────────────────────────────────
router.post('/:id/release', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return;
  }

  dal.releaseItem(id);
  res.json({ success: true });
});

export default router;
