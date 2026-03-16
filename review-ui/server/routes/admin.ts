import { Router } from 'express';
import * as dal from '../lib/dal.js';
import { importProgress, runImport, repairPaths } from '../scripts/import.js';

const router = Router();
// Note: requireAdmin is already applied at the router level in server/index.ts

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  const stats = dal.getAdminStats();
  res.json({ stats });
});

// ── GET /api/admin/leaderboard ────────────────────────────────────────────────
router.get('/leaderboard', (_req, res) => {
  const leaderboard = dal.getLeaderboard(true); // full names for admin
  res.json({ leaderboard });
});

// ── GET /api/admin/log ────────────────────────────────────────────────────────
router.get('/log', (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const filters = {
    action: req.query.action as string | undefined,
    user_id: req.query.user_id ? parseInt(String(req.query.user_id), 10) : undefined,
    date_from: req.query.date_from as string | undefined,
    date_to: req.query.date_to as string | undefined,
  };

  const { rows, total } = dal.getAdminLog(page, limit, filters);
  res.json({ rows, total, page, limit });
});

// ── GET /api/admin/idk-flagged ────────────────────────────────────────────────
router.get('/idk-flagged', (_req, res) => {
  const images = dal.getIdkFlagged();
  res.json({ images });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', (_req, res) => {
  const users = dal.getAllUsers();
  res.json({ users });
});

// ── POST /api/admin/import ────────────────────────────────────────────────────
router.post('/import', (_req, res) => {
  if (importProgress.status === 'running') {
    res.status(409).json({ error: 'Import already running' });
    return;
  }

  // Fire and forget — run async in background
  runImport({ skipThumbnails: false }).catch(err => {
    console.error('[admin] import error:', err);
    importProgress.status = 'error';
    importProgress.step = 'Error';
    importProgress.message = String(err);
  });

  res.status(202).json({ status: 'started' });
});

// ── POST /api/admin/repair-paths ──────────────────────────────────────────────
router.post('/repair-paths', (_req, res) => {
  if (importProgress.status === 'running') {
    res.status(409).json({ error: 'Import is running — wait for it to finish first' });
    return;
  }
  try {
    const result = repairPaths();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[admin] repair-paths error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Repair failed' });
  }
});

// ── GET /api/admin/import-status ─────────────────────────────────────────────
router.get('/import-status', (_req, res) => {
  const counts = dal.getImportCounts();
  res.json({ ...importProgress, counts });
});

export default router;
