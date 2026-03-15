import { Router } from 'express';

const router = Router();

// GET /api/queue/next
router.get('/next', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/queue/stats
router.get('/stats', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/queue/:id/release
router.post('/:id/release', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
