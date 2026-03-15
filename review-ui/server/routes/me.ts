import { Router } from 'express';
import * as dal from '../lib/dal.js';

const router = Router();

// ── GET /api/me/stats ─────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const stats = dal.getUserStats(req.user!.id);
  res.json(stats);
});

export default router;
