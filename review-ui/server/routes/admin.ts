import { Router } from 'express';

const router = Router();

// GET /api/admin/stats
router.get('/stats', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/admin/leaderboard
router.get('/leaderboard', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/admin/log
router.get('/log', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/admin/idk-flagged
router.get('/idk-flagged', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/admin/users
router.get('/users', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/admin/import
router.post('/import', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/admin/import-status
router.get('/import-status', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
