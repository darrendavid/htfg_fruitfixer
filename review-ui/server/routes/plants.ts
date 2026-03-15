import { Router } from 'express';

const router = Router();

// GET /api/plants/
router.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/plants/csv-candidates
router.get('/csv-candidates', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/plants/:id/reference-images
router.get('/:id/reference-images', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/plants/new
router.post('/new', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
