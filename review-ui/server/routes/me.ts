import { Router } from 'express';

const router = Router();

// GET /api/me/stats
router.get('/stats', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
