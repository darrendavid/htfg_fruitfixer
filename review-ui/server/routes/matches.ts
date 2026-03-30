import { Router, type Request, type Response } from 'express';
import path from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync, readFileSync, readdirSync, statSync } from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { nocodb } from '../lib/nocodb.js';
import { config } from '../config.js';

const router = Router();

// Project root — used to resolve relative file_path values from the JSON
const PROJECT_ROOT = path.resolve('d:/Sandbox/htfg_fruitfixer');

// Path to the phase 4C inferences JSON (optional — enriches results with plant/variety suggestions)
const INFERENCES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/phase4c_inferences.json');

// pass_01 base (sibling of assigned/)
const PASS01_BASE = path.resolve(config.IMAGE_MOUNT_PATH, '..');

// Unassigned root — scanned directly for all images
const UNASSIGNED_ROOT = path.join(PASS01_BASE, 'unassigned', 'unclassified');

// Image extensions to include
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']);

// ── Helper: async route wrapper ──────────────────────────────────────────────
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: Function) => {
    fn(req, res).catch(next);
  };
}

// ── Helper: safe cross-device move ───────────────────────────────────────────
function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch {
    // Cross-device link — fall back to copy + delete
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

// ── Helper: resolve unique dest filename (no collision) ───────────────────────
function resolveDestFilename(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = filename;
  let counter = 1;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem}_${counter}${ext}`;
    counter++;
  }
  return candidate;
}

// ── Helper: recursively walk directory for image files ───────────────────────
function walkImages(dir: string, results: Array<{ abs: string; rel: string }>, baseDir: string): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkImages(full, results, baseDir);
      } else if (IMG_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push({ abs: full, rel: path.relative(baseDir, full) });
      }
    }
  } catch { /* skip unreadable dirs */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches — Scan unassigned folder, enrich with inference data
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', asyncHandler(async (_req, res) => {
  if (!existsSync(UNASSIGNED_ROOT)) {
    res.json({ total: 0, matched: 0, unmatched: 0, groups: [] });
    return;
  }

  // 1. Walk the unassigned/unclassified folder for all images
  const files: Array<{ abs: string; rel: string }> = [];
  walkImages(UNASSIGNED_ROOT, files, UNASSIGNED_ROOT);

  // 2. Load inference data if available (keyed by file_path for fast lookup)
  const inferenceMap = new Map<string, any>();
  if (existsSync(INFERENCES_JSON)) {
    try {
      const parsed = JSON.parse(readFileSync(INFERENCES_JSON, 'utf-8'));
      const matches: any[] = parsed.matches || [];
      for (const m of matches) {
        // Key by filename for matching (inference file_path may differ from current location)
        inferenceMap.set(m.filename, m);
      }
    } catch { /* ignore corrupt JSON */ }
  }

  // 3. Build match items grouped by parent directory
  const groupMap = new Map<string, any[]>();
  let matched = 0;
  let unmatched = 0;

  for (const { abs, rel } of files) {
    const filename = path.basename(rel);
    const parentDir = path.dirname(rel).split(path.sep).pop() || 'root';
    const grandparentDir = path.dirname(path.dirname(rel)).split(path.sep).pop() || '';
    const filePath = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
    const st = statSync(abs);

    // Look up inference data by filename
    const inference = inferenceMap.get(filename);

    const item: Record<string, any> = {
      file_path: filePath,
      filename,
      parent_dir: parentDir,
      grandparent_dir: grandparentDir,
      file_size: st.size,
      // Inference fields (null if no match)
      plant_id: inference?.plant_id ?? null,
      plant_name: inference?.plant_name ?? null,
      variety_id: inference?.variety_id ?? null,
      variety_name: inference?.variety_name ?? null,
      confidence: inference?.confidence ?? null,
      match_type: inference?.match_type ?? null,
      signals: inference?.signals ?? [],
    };

    if (inference) matched++;
    else unmatched++;

    if (!groupMap.has(parentDir)) groupMap.set(parentDir, []);
    groupMap.get(parentDir)!.push(item);
  }

  // Sort groups alphabetically, items within groups by filename
  const groups = [...groupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, matches]) => ({
      folder,
      count: matches.length,
      matches: matches.sort((a: any, b: any) => a.filename.localeCompare(b.filename)),
    }));

  res.json({ total: files.length, matched, unmatched, groups });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/approve — Copy image to plant dir + create NocoDB record
// ══════════════════════════════════════════════════════════════════════════════
router.post('/approve', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, plant_id, variety_id, filename } = req.body as {
    file_path: string;
    plant_id: string | number;
    variety_id?: string | number;
    filename: string;
  };

  if (!file_path || !plant_id || !filename) {
    res.status(400).json({ error: 'file_path, plant_id, and filename are required' });
    return;
  }

  const srcAbs = path.resolve(PROJECT_ROOT, file_path);
  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: 'Source file not found', file_path });
    return;
  }

  // Destination directory: IMAGE_MOUNT_PATH/{plant_id}/images/
  const destDir = path.join(config.IMAGE_MOUNT_PATH, String(plant_id), 'images');
  mkdirSync(destDir, { recursive: true });

  const safeFilename = resolveDestFilename(destDir, filename);
  const destAbs = path.join(destDir, safeFilename);

  // Copy file first so we can verify before deleting source
  copyFileSync(srcAbs, destAbs);

  // NocoDB record fields
  const stem = path.basename(safeFilename, path.extname(safeFilename));
  const { size: sizeBytes } = await import('fs').then(f => Promise.resolve(f.statSync(destAbs)));
  const nocoRecord: Record<string, any> = {
    File_Path: `content/pass_01/assigned/${plant_id}/images/${safeFilename}`,
    Plant_Id: plant_id,
    Caption: stem,
    Source_Directory: path.dirname(file_path),
    Size_Bytes: sizeBytes,
    Status: 'assigned',
    Excluded: false,
  };
  if (variety_id !== undefined && variety_id !== null && variety_id !== '') {
    nocoRecord.Variety_Id = variety_id;
  }
  if (config.IMAGES_AUTO_ATTRIBUTION) {
    nocoRecord.Attribution = config.IMAGES_AUTO_ATTRIBUTION;
  }

  let nocodbId: number | null = null;
  try {
    const created = await nocodb.create('Images', nocoRecord);
    nocodbId = created?.Id ?? created?.[0]?.Id ?? null;
  } catch (err) {
    // DB write failed — undo copy and propagate error
    try { unlinkSync(destAbs); } catch { /* ignore cleanup error */ }
    throw err;
  }

  // Remove source after successful DB write
  try { unlinkSync(srcAbs); } catch { /* non-fatal */ }

  res.json({
    success: true,
    nocodb_id: nocodbId,
    dest_path: `content/pass_01/assigned/${plant_id}/images/${safeFilename}`,
    undo_token: {
      type: 'approve',
      nocodb_id: nocodbId,
      dest_path: destAbs,
      original_path: srcAbs,
      filename: safeFilename,
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/review — Move file to _to_triage/
// ══════════════════════════════════════════════════════════════════════════════
router.post('/review', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, filename } = req.body as { file_path: string; filename: string };

  if (!file_path || !filename) {
    res.status(400).json({ error: 'file_path and filename are required' });
    return;
  }

  const srcAbs = path.resolve(PROJECT_ROOT, file_path);
  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: 'Source file not found', file_path });
    return;
  }

  const destDir = path.join(PASS01_BASE, 'unassigned', '_to_triage');
  mkdirSync(destDir, { recursive: true });

  const safeFilename = resolveDestFilename(destDir, filename);
  const destAbs = path.join(destDir, safeFilename);

  moveFile(srcAbs, destAbs);

  res.json({
    success: true,
    undo_token: {
      type: 'review',
      dest_path: destAbs,
      original_path: srcAbs,
      filename: safeFilename,
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/ignore — Move file to ignored/
// ══════════════════════════════════════════════════════════════════════════════
router.post('/ignore', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, filename } = req.body as { file_path: string; filename: string };

  if (!file_path || !filename) {
    res.status(400).json({ error: 'file_path and filename are required' });
    return;
  }

  const srcAbs = path.resolve(PROJECT_ROOT, file_path);
  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: 'Source file not found', file_path });
    return;
  }

  const destDir = path.join(PASS01_BASE, 'unassigned', 'ignored');
  mkdirSync(destDir, { recursive: true });

  const safeFilename = resolveDestFilename(destDir, filename);
  const destAbs = path.join(destDir, safeFilename);

  moveFile(srcAbs, destAbs);

  res.json({
    success: true,
    undo_token: {
      type: 'ignore',
      dest_path: destAbs,
      original_path: srcAbs,
      filename: safeFilename,
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/undo — Reverse last action
// ══════════════════════════════════════════════════════════════════════════════
router.post('/undo', requireAdmin, asyncHandler(async (req, res) => {
  const { undo_token } = req.body as {
    undo_token: {
      type: 'approve' | 'review' | 'ignore';
      original_path: string;
      dest_path: string;
      nocodb_id?: number | null;
      filename: string;
    };
  };

  if (!undo_token || !undo_token.type || !undo_token.original_path || !undo_token.dest_path) {
    res.status(400).json({ error: 'Invalid undo_token' });
    return;
  }

  const { type, original_path, dest_path, nocodb_id } = undo_token;

  if (!existsSync(dest_path)) {
    res.status(404).json({ error: 'Destination file no longer exists — cannot undo', dest_path });
    return;
  }

  // Recreate original directory if needed
  const originalDir = path.dirname(original_path);
  mkdirSync(originalDir, { recursive: true });

  if (type === 'approve') {
    // Delete NocoDB record first
    if (nocodb_id != null) {
      try {
        await nocodb.delete('Images', nocodb_id);
      } catch (err) {
        // Log but continue — file move is more important
        console.warn('[matches/undo] NocoDB delete failed:', err);
      }
    }
    // Move file back to original location
    moveFile(dest_path, original_path);
  } else {
    // review or ignore — just move back
    moveFile(dest_path, original_path);
  }

  res.json({ success: true, restored_path: original_path });
}));

export default router;
