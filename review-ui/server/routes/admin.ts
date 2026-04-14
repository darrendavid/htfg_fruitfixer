import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import * as dal from '../lib/dal.js';
import { importProgress, runImport, repairPaths } from '../scripts/import.js';
import { nocodb } from '../lib/nocodb.js';
import db from '../lib/db.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');

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

// ── GET /api/admin/export — Download full database as JSON ───────────────────
router.get('/export', async (_req, res) => {
  try {
    const tables = nocodb.getTableNames();
    const data: Record<string, any[]> = {};

    for (const table of tables) {
      const all: any[] = [];
      let offset = 0;
      while (true) {
        const result = await nocodb.list(table, { limit: 200, offset });
        all.push(...result.list);
        if (result.pageInfo?.isLastPage || result.list.length === 0) break;
        offset += 200;
      }
      data[table] = all;
    }

    // Also export local SQLite tables
    data._sqlite_hero_images = db.prepare('SELECT * FROM hero_images').all();
    data._sqlite_staff_notes = db.prepare('SELECT * FROM staff_notes').all();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="htfg-export-${timestamp}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      tables: Object.keys(data).map(t => ({ name: t, count: data[t].length })),
      data,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

// ── POST /api/admin/backup — Full NocoDB backup, saves to disk + returns download ─
router.post('/backup', async (_req, res) => {
  const PAGE_SIZE = 1000;
  try {
    const tables = nocodb.getTableNames();
    const data: Record<string, any[]> = {};
    const summary: Record<string, number> = {};

    for (const table of tables) {
      const all: any[] = [];
      let offset = 0;
      while (true) {
        const result = await nocodb.list(table, { limit: PAGE_SIZE, offset });
        all.push(...result.list);
        if (result.pageInfo?.isLastPage || result.list.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      data[table] = all;
      summary[table] = all.length;
    }

    // Also snapshot local SQLite tables
    data._sqlite_staff_notes = db.prepare('SELECT * FROM staff_notes').all() as any[];
    data._sqlite_attachment_ocr_decisions = db.prepare('SELECT * FROM attachment_ocr_decisions').all() as any[];
    summary._sqlite_staff_notes = (data._sqlite_staff_notes as any[]).length;
    summary._sqlite_attachment_ocr_decisions = (data._sqlite_attachment_ocr_decisions as any[]).length;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const payload = {
      exported_at: new Date().toISOString(),
      summary,
      data,
    };

    // Save to disk
    const outDir = path.join(PROJECT_ROOT, 'content', 'backups', `nocodb-${timestamp}`);
    mkdirSync(outDir, { recursive: true });
    for (const [name, records] of Object.entries(data)) {
      writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(records, null, 2));
    }
    writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify({ exported_at: payload.exported_at, tables: summary }, null, 2));

    // Return as download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="nocodb-backup-${timestamp}.json"`);
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

// ── POST /api/admin/import — Restore database from exported JSON ────────────
router.post('/import', async (req, res) => {
  // This is the existing import from files — keep it as-is
  // The JSON restore would be a separate feature if needed
  if (importProgress.status === 'running') {
    res.status(409).json({ error: 'Import is already running' });
    return;
  }

  runImport().catch((err) => {
    console.error('[admin] import error:', err);
    importProgress.status = 'error';
    importProgress.error = err.message;
  });

  res.status(202).json({ status: 'started' });
});

export default router;
