import { Router } from 'express';

const router = Router();

// GET /api/leaderboard/
router.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
