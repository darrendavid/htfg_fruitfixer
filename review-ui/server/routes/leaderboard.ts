import { Router } from 'express';
import * as dal from '../lib/dal.js';

const router = Router();

// ── GET /api/leaderboard ──────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const leaderboard = dal.getLeaderboard(false); // initials only for public
  res.json({ leaderboard });
});

export default router;
