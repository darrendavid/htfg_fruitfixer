import { Router } from 'express';

const router = Router();

// POST /api/auth/register
router.post('/register', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/auth/login
router.post('/login', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/auth/verify/:token
router.get('/verify/:token', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/auth/me
router.get('/me', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/auth/admin/login
router.post('/admin/login', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
