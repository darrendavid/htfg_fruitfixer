import { Router } from 'express';

const router = Router();

// POST /api/review/confirm
router.post('/confirm', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/review/reject
router.post('/reject', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/review/classify
router.post('/classify', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/review/discard
router.post('/discard', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/review/idk
router.post('/idk', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
