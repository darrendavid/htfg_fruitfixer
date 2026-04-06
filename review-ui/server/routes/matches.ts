import { Router, type Request, type Response } from 'express';
import path from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync, readFileSync, readdirSync, statSync } from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { nocodb } from '../lib/nocodb.js';
import { config } from '../config.js';

const router = Router();

// Project root — derived from CONTENT_ROOT env var (content/ is one level down from root)
const PROJECT_ROOT = path.resolve(config.CONTENT_ROOT, '..');

// Path to the phase 4C inferences JSON (optional — enriches results with plant/variety suggestions)
const INFERENCES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/phase4c_inferences.json');

// Path to assigned-variety inferences JSON
const VARIETY_INFERENCES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/assigned_variety_inferences.json');

// pass_01 base (sibling of assigned/)
const PASS01_BASE = path.resolve(config.IMAGE_MOUNT_PATH, '..');

// Unassigned root — scanned directly for all images
const UNASSIGNED_ROOT = path.join(PASS01_BASE, 'unassigned', '_to_triage');

// Image extensions
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']);
// Document extensions (shown as attachments in the UI)
const DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt']);

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

// ── Helper: recursively walk directory for image + document files ─────────────
function walkFiles(dir: string, results: Array<{ abs: string; rel: string; fileType: 'image' | 'document' }>, baseDir: string): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full, results, baseDir);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMG_EXTS.has(ext)) results.push({ abs: full, rel: path.relative(baseDir, full), fileType: 'image' });
        else if (DOC_EXTS.has(ext)) results.push({ abs: full, rel: path.relative(baseDir, full), fileType: 'document' });
      }
    }
  } catch { /* skip unreadable dirs */ }
}

// ── Helper: load inference map from JSON (keyed by file_path) ────────────────
// Must be keyed by file_path, not filename — many files share the same name
// (e.g. DSC_0007.JPG) across different folders; filename-keying silently drops
// all but the last match for each name.
function loadInferenceMap(): Map<string, any> {
  const map = new Map<string, any>();
  if (existsSync(INFERENCES_JSON)) {
    try {
      const parsed = JSON.parse(readFileSync(INFERENCES_JSON, 'utf-8'));
      for (const m of parsed.matches || []) {
        if (m.file_path) map.set(m.file_path.replace(/\\/g, '/'), m);
      }
    } catch { /* ignore corrupt JSON */ }
  }
  return map;
}

// ── Helper: build a single MatchItem from a file entry ───────────────────────
function buildItem(abs: string, rel: string, fileType: 'image' | 'document', inference: any | undefined): Record<string, any> {
  const filename = path.basename(rel);
  const relDir = path.dirname(rel).replace(/\\/g, '/');
  const parts = relDir.split('/');
  const st = statSync(abs);

  let txtPreview: string | undefined;
  if (fileType === 'document' && path.extname(filename).toLowerCase() === '.txt') {
    try { txtPreview = readFileSync(abs, 'utf-8').slice(0, 400).trim(); } catch { /* ignore */ }
  }

  return {
    file_path: path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/'),
    filename,
    parent_dir: parts[parts.length - 1] || 'root',
    grandparent_dir: parts[parts.length - 2] || '',
    file_size: st.size,
    file_type: fileType,
    txt_preview: txtPreview,
    plant_id: inference?.plant_id ?? null,
    plant_name: inference?.plant_name ?? null,
    variety_id: inference?.variety_id ?? null,
    variety_name: inference?.variety_name ?? null,
    confidence: inference?.confidence ?? null,
    match_type: inference?.match_type ?? null,
    signals: inference?.signals ?? [],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches
//   No ?folder  → return folder list only (fast: no statSync, no file reads)
//   ?folder=rel → return full items for that folder only
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', asyncHandler(async (req, res) => {
  if (!existsSync(UNASSIGNED_ROOT)) {
    res.json({ total: 0, groups: [] });
    return;
  }

  const folderParam = req.query.folder as string | undefined;

  // ── Folder-items mode ────────────────────────────────────────────────────
  if (folderParam !== undefined) {
    const targetDir = (folderParam === '' || folderParam === '.')
      ? UNASSIGNED_ROOT
      : path.join(UNASSIGNED_ROOT, folderParam.replace(/\//g, path.sep));

    const files: Array<{ abs: string; rel: string; fileType: 'image' | 'document' }> = [];
    if (existsSync(targetDir)) walkFiles(targetDir, files, UNASSIGNED_ROOT);

    const inferenceMap = loadInferenceMap();
    let matched = 0;
    const items: Record<string, any>[] = [];

    for (const { abs, rel, fileType } of files) {
      const filePath = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
      const inference = inferenceMap.get(filePath);
      items.push(buildItem(abs, rel, fileType, inference));
      if (inference) matched++;
    }

    // Debug: log first few items with variety data
    const withVariety = items.filter(i => i.variety_id != null);
    if (withVariety.length > 0) {
      console.log(`[matches] folder="${folderParam}" ${items.length} items, ${matched} matched, ${withVariety.length} with variety`);
      console.log(`[matches] sample:`, JSON.stringify({ fp: withVariety[0].file_path, vid: withVariety[0].variety_id, vn: withVariety[0].variety_name }));
    } else if (matched > 0) {
      console.log(`[matches] folder="${folderParam}" ${items.length} items, ${matched} matched, 0 with variety`);
      const sample = items.find(i => i.plant_id);
      if (sample) console.log(`[matches] sample (no variety):`, JSON.stringify({ fp: sample.file_path, pid: sample.plant_id }));
    } else {
      console.log(`[matches] folder="${folderParam}" ${items.length} items, 0 matched (inferenceMap size: ${inferenceMap.size})`);
      if (files.length > 0) {
        const samplePath = path.relative(PROJECT_ROOT, files[0].abs).replace(/\\/g, '/');
        console.log(`[matches] first file path: "${samplePath}"`);
      }
    }

    // Sort by confidence (high > medium > low > null), then filename
    const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => {
      const ca = a.confidence ? (confOrder[a.confidence] ?? 3) : 3;
      const cb = b.confidence ? (confOrder[b.confidence] ?? 3) : 3;
      if (ca !== cb) return ca - cb;
      return (a.filename as string).localeCompare(b.filename as string);
    });
    res.json({ folder: folderParam, total: items.length, matched, items });
    return;
  }

  // ── Folder-list mode (no statSync, no file reads) ────────────────────────
  const files: Array<{ abs: string; rel: string; fileType: 'image' | 'document' }> = [];
  walkFiles(UNASSIGNED_ROOT, files, UNASSIGNED_ROOT);

  // Load inferred file_paths for matched counts (keyed by file_path, same as buildItem)
  const inferredPaths = new Set<string>();
  if (existsSync(INFERENCES_JSON)) {
    try {
      const parsed = JSON.parse(readFileSync(INFERENCES_JSON, 'utf-8'));
      for (const m of parsed.matches || []) {
        if (m.file_path) inferredPaths.add(m.file_path.replace(/\\/g, '/'));
      }
    } catch { /* ignore */ }
  }

  // Group by top-level directory so counts match folder-items mode (which walks recursively)
  const groupMap = new Map<string, { count: number; matched: number }>();
  for (const { abs, rel } of files) {
    const relNorm = rel.replace(/\\/g, '/');
    const parts = relNorm.split('/');
    // Use the top-level directory as the group key (e.g. "Bananaspapaya" not "Bananaspapaya/sub/sub")
    // Files at root level (no subdirectory) go under "."
    const topDir = parts.length > 1 ? parts[0] : '.';
    if (!groupMap.has(topDir)) groupMap.set(topDir, { count: 0, matched: 0 });
    const g = groupMap.get(topDir)!;
    g.count++;
    const filePath = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
    if (inferredPaths.has(filePath)) g.matched++;
  }

  const groups = [...groupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, { count, matched }]) => ({
      folder,                                          // top-level directory (unique key)
      displayName: folder === '.' ? '(root)' : folder, // display name
      count,
      matched,
    }));

  res.json({ total: files.length, groups });
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
// POST /api/matches/attach — Copy doc/txt to plant attachments dir + NocoDB record
// ══════════════════════════════════════════════════════════════════════════════
router.post('/attach', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, plant_id, filename } = req.body as {
    file_path: string;
    plant_id: string;
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

  const destDir = path.join(config.IMAGE_MOUNT_PATH, plant_id, 'attachments');
  mkdirSync(destDir, { recursive: true });

  const safeFilename = resolveDestFilename(destDir, filename);
  const destAbs = path.join(destDir, safeFilename);

  copyFileSync(srcAbs, destAbs);

  const ext = path.extname(safeFilename).replace('.', '').toLowerCase();
  const title = path.basename(safeFilename, path.extname(safeFilename)).replace(/[_\-]/g, ' ');
  const { size } = statSync(destAbs);
  const relPath = path.relative(PROJECT_ROOT, destAbs).replace(/\\/g, '/');

  let nocodbId: number | null = null;
  try {
    const record = await nocodb.create('Attachments', {
      Title: title,
      File_Path: relPath,
      File_Name: safeFilename,
      File_Type: ext || 'bin',
      File_Size: size,
      Plant_Ids: JSON.stringify([plant_id]),
    });
    nocodbId = record?.Id ?? null;
  } catch (err) {
    try { unlinkSync(destAbs); } catch { /* ignore */ }
    throw err;
  }

  try { unlinkSync(srcAbs); } catch { /* non-fatal */ }

  res.json({
    success: true,
    nocodb_id: nocodbId,
    dest_path: relPath,
    undo_token: {
      type: 'attach',
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
// POST /api/matches/bulk-approve — Approve multiple images at once
// ══════════════════════════════════════════════════════════════════════════════
router.post('/bulk-approve', requireAdmin, asyncHandler(async (req, res) => {
  const { items, plant_id, variety_id } = req.body as {
    items: Array<{ file_path: string; filename: string }>;
    plant_id: string;
    variety_id?: number | null;
  };

  if (!Array.isArray(items) || items.length === 0 || !plant_id) {
    res.status(400).json({ error: 'items array and plant_id are required' });
    return;
  }

  const results: Array<{ file_path: string; success: boolean; undo_token?: any; error?: string }> = [];

  for (const item of items) {
    const { file_path, filename } = item;
    const srcAbs = path.resolve(PROJECT_ROOT, file_path);
    if (!existsSync(srcAbs)) {
      results.push({ file_path, success: false, error: 'not found' });
      continue;
    }

    const destDir = path.join(config.IMAGE_MOUNT_PATH, String(plant_id), 'images');
    mkdirSync(destDir, { recursive: true });
    const safeFilename = resolveDestFilename(destDir, filename);
    const destAbs = path.join(destDir, safeFilename);

    try {
      copyFileSync(srcAbs, destAbs);
      const stem = path.basename(safeFilename, path.extname(safeFilename));
      const { size: sizeBytes } = statSync(destAbs);
      const nocoRecord: Record<string, any> = {
        File_Path: `content/pass_01/assigned/${plant_id}/images/${safeFilename}`,
        Plant_Id: plant_id,
        Caption: stem,
        Source_Directory: path.dirname(file_path),
        Size_Bytes: sizeBytes,
        Status: 'assigned',
        Excluded: false,
      };
      if (variety_id !== undefined && variety_id !== null) nocoRecord.Variety_Id = variety_id;
      if (config.IMAGES_AUTO_ATTRIBUTION) nocoRecord.Attribution = config.IMAGES_AUTO_ATTRIBUTION;

      const created = await nocodb.create('Images', nocoRecord);
      const nocodbId = created?.Id ?? created?.[0]?.Id ?? null;
      try { unlinkSync(srcAbs); } catch { /* non-fatal */ }

      results.push({
        file_path,
        success: true,
        undo_token: {
          type: 'approve',
          nocodb_id: nocodbId,
          dest_path: destAbs,
          original_path: srcAbs,
          filename: safeFilename,
        },
      });
    } catch (err: any) {
      try { unlinkSync(destAbs); } catch { /* ignore */ }
      results.push({ file_path, success: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.success);
  res.json({ success: true, processed: results.length, succeeded: succeeded.length, results });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/bulk-ignore — Ignore multiple files at once
// ══════════════════════════════════════════════════════════════════════════════
router.post('/bulk-ignore', requireAdmin, asyncHandler(async (req, res) => {
  const { items } = req.body as { items: Array<{ file_path: string; filename: string }> };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const destDir = path.join(PASS01_BASE, 'unassigned', 'ignored');
  mkdirSync(destDir, { recursive: true });

  const results: Array<{ file_path: string; success: boolean; undo_token?: any; error?: string }> = [];

  for (const item of items) {
    const { file_path, filename } = item;
    const srcAbs = path.resolve(PROJECT_ROOT, file_path);
    if (!existsSync(srcAbs)) {
      results.push({ file_path, success: false, error: 'not found' });
      continue;
    }
    const safeFilename = resolveDestFilename(destDir, filename);
    const destAbs = path.join(destDir, safeFilename);
    try {
      moveFile(srcAbs, destAbs);
      results.push({
        file_path,
        success: true,
        undo_token: { type: 'ignore', dest_path: destAbs, original_path: srcAbs, filename: safeFilename },
      });
    } catch (err: any) {
      results.push({ file_path, success: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.success);
  res.json({ success: true, processed: results.length, succeeded: succeeded.length, results });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/variety-suggestions — Variety inference results for assigned images
//   No ?plant  → return plant groups only
//   ?plant=id  → return items for that plant
// ══════════════════════════════════════════════════════════════════════════════
router.get('/variety-suggestions', asyncHandler(async (req, res) => {
  if (!existsSync(VARIETY_INFERENCES_JSON)) {
    res.json({ total: 0, groups: [] });
    return;
  }

  let parsed: any;
  try { parsed = JSON.parse(readFileSync(VARIETY_INFERENCES_JSON, 'utf-8')); } catch {
    res.json({ total: 0, groups: [] });
    return;
  }

  const rawMatches: any[] = parsed.matches || [];

  // Filter out images that already have a Variety_Id set (previously accepted).
  // Fetch all image IDs that have a variety assigned in one paginated query.
  const assignedSet = new Set<number>();
  try {
    let offset = 0;
    while (true) {
      const result = await nocodb.list('Images', {
        where: '(Variety_Id,notblank)',
        fields: ['Id'],
        limit: 200,
        offset,
      });
      for (const r of result.list) assignedSet.add(r.Id);
      if (result.pageInfo?.isLastPage || result.list.length === 0) break;
      offset += 200;
    }
  } catch { /* continue without filtering if NocoDB fails */ }

  const allMatches = rawMatches.filter((m: any) => !assignedSet.has(m.image_id));
  const plantParam = req.query.plant as string | undefined;

  if (plantParam !== undefined) {
    const items = allMatches.filter((m: any) => m.plant_id === plantParam);
    const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    items.sort((a: any, b: any) => (confOrder[a.confidence] ?? 3) - (confOrder[b.confidence] ?? 3) || a.filename.localeCompare(b.filename));
    res.json({ plant_id: plantParam, plant_name: items[0]?.plant_name ?? plantParam, total: items.length, items });
    return;
  }

  // Group by plant
  const groupMap = new Map<string, { plant_name: string; count: number }>();
  for (const m of allMatches) {
    if (!groupMap.has(m.plant_id)) groupMap.set(m.plant_id, { plant_name: m.plant_name, count: 0 });
    groupMap.get(m.plant_id)!.count++;
  }
  const groups = [...groupMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([plant_id, { plant_name, count }]) => ({ plant_id, plant_name, count }));

  res.json({ total: allMatches.length, groups });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/accept-variety — Accept a variety suggestion (update NocoDB)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/accept-variety', requireAdmin, asyncHandler(async (req, res) => {
  const { image_id, variety_id } = req.body as { image_id: number; variety_id: number };
  if (!image_id || !variety_id) {
    res.status(400).json({ error: 'image_id and variety_id are required' });
    return;
  }
  await nocodb.update('Images', image_id, { Variety_Id: variety_id });
  res.json({
    success: true,
    undo_token: { type: 'accept-variety', image_id, variety_id, previous_variety_id: null },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/bulk-accept-variety — Accept multiple variety suggestions
// ══════════════════════════════════════════════════════════════════════════════
router.post('/bulk-accept-variety', requireAdmin, asyncHandler(async (req, res) => {
  const { items } = req.body as { items: Array<{ image_id: number; variety_id: number }> };
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }
  const updates = items.map(i => ({ Id: i.image_id, Variety_Id: i.variety_id }));
  for (let i = 0; i < updates.length; i += 100) {
    await nocodb.bulkUpdate('Images', updates.slice(i, i + 100));
  }
  res.json({ success: true, count: items.length });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/undo — Reverse last action
// ══════════════════════════════════════════════════════════════════════════════
router.post('/undo', requireAdmin, asyncHandler(async (req, res) => {
  const { undo_token } = req.body as {
    undo_token: {
      type: 'approve' | 'review' | 'ignore' | 'accept-variety';
      original_path: string;
      dest_path: string;
      nocodb_id?: number | null;
      filename: string;
    };
  };

  if (!undo_token || !undo_token.type) {
    res.status(400).json({ error: 'Invalid undo_token' });
    return;
  }

  const { type } = undo_token;

  // Accept-variety undo: just clear the Variety_Id back to null
  if (type === 'accept-variety') {
    const { image_id } = undo_token as any;
    if (!image_id) { res.status(400).json({ error: 'image_id required for accept-variety undo' }); return; }
    await nocodb.update('Images', image_id, { Variety_Id: null });
    res.json({ success: true });
    return;
  }

  // File-based undo types require paths
  const { original_path, dest_path, nocodb_id } = undo_token as any;
  if (!original_path || !dest_path) {
    res.status(400).json({ error: 'Invalid undo_token: missing paths' });
    return;
  }

  if (!existsSync(dest_path)) {
    res.status(404).json({ error: 'Destination file no longer exists — cannot undo', dest_path });
    return;
  }

  // Recreate original directory if needed
  const originalDir = path.dirname(original_path);
  mkdirSync(originalDir, { recursive: true });

  if (type === 'approve') {
    if (nocodb_id != null) {
      try { await nocodb.delete('Images', nocodb_id); } catch (err) {
        console.warn('[matches/undo] NocoDB delete failed:', err);
      }
    }
    moveFile(dest_path, original_path);
  } else if (type === 'attach') {
    if (nocodb_id != null) {
      try { await nocodb.delete('Attachments', nocodb_id); } catch (err) {
        console.warn('[matches/undo] NocoDB delete failed:', err);
      }
    }
    moveFile(dest_path, original_path);
  } else {
    // review or ignore — just move back
    moveFile(dest_path, original_path);
  }

  res.json({ success: true, restored_path: original_path });
}));

export default router;
