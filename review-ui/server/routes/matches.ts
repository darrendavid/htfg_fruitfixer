import { Router } from 'express';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { nocodb } from '../lib/nocodb.js';
import { config } from '../config.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { moveFile, resolveDestFilename, walkFiles, IMG_EXTS, DOC_EXTS, type WalkEntry } from '../lib/file-ops.js';
import { fetchAllPages } from '../lib/nocodb-helpers.js';
import db from '../lib/db.js';

const router = Router();

// Project root — derived from CONTENT_ROOT env var (content/ is one level down from root)
const PROJECT_ROOT = path.resolve(config.CONTENT_ROOT, '..');

// Path to the phase 4C inferences JSON (optional — enriches results with plant/variety suggestions)
const INFERENCES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/phase4c_inferences.json');

// Path to assigned-variety inferences JSON
const VARIETY_INFERENCES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/assigned_variety_inferences.json');

// Path to lost image recovery JSON
const LOST_IMAGES_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/lost_image_recovery.json');

// Path to dedup review JSON
const DEDUP_REVIEW_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/dedup_review.json');

// pass_01 base (sibling of assigned/)
const PASS01_BASE = path.resolve(config.IMAGE_MOUNT_PATH, '..');

// Unassigned root — scanned directly for all images
const UNASSIGNED_ROOT = path.join(PASS01_BASE, 'unassigned', '_to_triage');

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
// GET /api/matches/triage — All images flagged for triage (Status='unassigned' with no Plant_Id,
//   OR files in _to_triage/ folder)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/triage', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit as string) || 100);
  const qOffset = parseInt(req.query.offset as string) || 0;

  // Query NocoDB for images with Status='unassigned' and no Plant_Id (flagged for triage)
  const result = await nocodb.list('Images', {
    where: '(Status,eq,triage)~and(Excluded,neq,true)',
    limit,
    offset: qOffset,
  });

  // Also scan _to_triage/ folder for filesystem-based items
  const fsItems: any[] = [];
  if (existsSync(UNASSIGNED_ROOT)) {
    const files: WalkEntry[] = [];
    walkFiles(UNASSIGNED_ROOT, files, UNASSIGNED_ROOT);
    for (const { abs, rel, fileType } of files) {
      fsItems.push({
        source: 'filesystem',
        file_path: path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/'),
        filename: path.basename(rel),
        file_type: fileType,
        file_size: statSync(abs).size,
      });
    }
  }

  const dbItems = (result.list || []).map((img: any) => ({
    source: 'database',
    image_id: img.Id,
    file_path: img.File_Path,
    filename: (img.File_Path || '').split('/').pop(),
    original_filepath: img.Original_Filepath,
    caption: img.Caption,
    file_size: img.Size_Bytes || 0,
    file_type: 'image' as const,
  }));

  res.json({
    total_db: result.pageInfo?.totalRows ?? dbItems.length,
    total_fs: fsItems.length,
    offset: qOffset,
    limit,
    db_items: dbItems,
    fs_items: qOffset === 0 ? fsItems : [], // Only send filesystem items on first page
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/assign-triage-fs — Assign filesystem triage items to a plant
//   Moves file to assigned/{plant_id}/images/, creates NocoDB record, sets Status=assigned
// ══════════════════════════════════════════════════════════════════════════════
router.post('/assign-triage-fs', requireAdmin, asyncHandler(async (req, res) => {
  const { file_paths, plant_id } = req.body as { file_paths: string[]; plant_id: string };
  if (!file_paths?.length || !plant_id) {
    res.status(400).json({ error: 'file_paths[] and plant_id required' });
    return;
  }

  const results: Array<{ file_path: string; success: boolean; image_id?: number; error?: string }> = [];

  const destDir = path.join(config.IMAGE_MOUNT_PATH, plant_id, 'images');
  mkdirSync(destDir, { recursive: true });

  for (const fp of file_paths) {
    // fp is relative to PROJECT_ROOT (e.g. "content/pass_01/unassigned/_to_triage/foo.jpg")
    const absSource = path.resolve(PROJECT_ROOT, fp);
    if (!existsSync(absSource)) {
      results.push({ file_path: fp, success: false, error: 'File not found' });
      continue;
    }

    try {
      const filename = path.basename(fp);
      const safeFilename = resolveDestFilename(destDir, filename);
      const absDest = path.join(destDir, safeFilename);
      moveFile(absSource, absDest);

      // Relative path from content/ root (what NocoDB stores)
      const relDest = path.relative(path.resolve(PROJECT_ROOT, 'content'), absDest).replace(/\\/g, '/');
      const filePath = 'content/' + relDest;

      // Create NocoDB record
      const stat = statSync(absDest);
      const record = await nocodb.create('Images', {
        File_Path: filePath,
        Plant_Id: plant_id,
        Status: 'assigned',
        Size_Bytes: stat.size,
        Caption: path.basename(safeFilename, path.extname(safeFilename)).replace(/[_-]/g, ' '),
        Source_Directory: path.relative(path.resolve(PROJECT_ROOT, 'content'), path.dirname(absDest)).replace(/\\/g, '/'),
        Attribution: config.IMAGES_AUTO_ATTRIBUTION || null,
      });

      const imageId = Array.isArray(record) ? record[0]?.Id : record?.Id;
      results.push({ file_path: fp, success: true, image_id: imageId });
    } catch (err: any) {
      results.push({ file_path: fp, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  res.json({ success: succeeded > 0, succeeded, total: results.length, results });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/hide-triage-fs — Hide filesystem triage items (no plant)
//   Moves file to unassigned/ignored/, creates NocoDB record with Status=hidden
// ══════════════════════════════════════════════════════════════════════════════
router.post('/hide-triage-fs', requireAdmin, asyncHandler(async (req, res) => {
  const { file_paths } = req.body as { file_paths: string[] };
  if (!file_paths?.length) {
    res.status(400).json({ error: 'file_paths[] required' });
    return;
  }

  const destDir = path.join(PASS01_BASE, 'unassigned', 'ignored');
  mkdirSync(destDir, { recursive: true });

  const results: Array<{ file_path: string; success: boolean; image_id?: number; error?: string }> = [];

  for (const fp of file_paths) {
    const absSource = path.resolve(PROJECT_ROOT, fp);
    if (!existsSync(absSource)) {
      results.push({ file_path: fp, success: false, error: 'File not found' });
      continue;
    }
    try {
      const filename = path.basename(fp);
      const safeFilename = resolveDestFilename(destDir, filename);
      const absDest = path.join(destDir, safeFilename);
      moveFile(absSource, absDest);

      const relDest = path.relative(path.resolve(PROJECT_ROOT, 'content'), absDest).replace(/\\/g, '/');
      const filePath = 'content/' + relDest;

      const stat = statSync(absDest);
      const record = await nocodb.create('Images', {
        File_Path: filePath,
        Plant_Id: null,
        Status: 'hidden',
        Size_Bytes: stat.size,
        Caption: path.basename(safeFilename, path.extname(safeFilename)).replace(/[_-]/g, ' '),
        Source_Directory: path.relative(path.resolve(PROJECT_ROOT, 'content'), path.dirname(absDest)).replace(/\\/g, '/'),
        Attribution: config.IMAGES_AUTO_ATTRIBUTION || null,
      });

      const imageId = Array.isArray(record) ? record[0]?.Id : record?.Id;
      results.push({ file_path: fp, success: true, image_id: imageId });
    } catch (err: any) {
      results.push({ file_path: fp, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  res.json({ success: succeeded > 0, succeeded, total: results.length, results });
}));

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

    const files: WalkEntry[] = [];
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
  const files: WalkEntry[] = [];
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

  // Filter out images that have been acted on: Variety_Id set OR Plant_Id changed.
  // Query the specific image IDs from the inference JSON to get their current NocoDB state.
  // Build a map: image_id → { variety_id, plant_id } for cross-checking.
  const currentState = new Map<number, { variety_id: number | null; plant_id: string | null; status: string | null }>();
  const inferenceIds = rawMatches.map((m: any) => m.image_id as number).filter(Boolean);
  for (let i = 0; i < inferenceIds.length; i += 100) {
    const batch = inferenceIds.slice(i, i + 100);
    try {
      const result = await nocodb.list('Images', {
        where: `(Id,in,${batch.join(',')})`,
        fields: ['Id', 'Variety_Id', 'Plant_Id', 'Status'],
        limit: 100,
      });
      for (const r of result.list) {
        currentState.set(r.Id, { variety_id: r.Variety_Id ?? null, plant_id: r.Plant_Id ?? null, status: r.Status ?? null });
      }
    } catch (err) {
      console.error('[variety-suggestions] batch query failed:', err);
    }
  }

  // Collect any new plant IDs (from reassignments) that aren't in the inference JSON
  const knownPlantNames = new Map<string, string>(rawMatches.map((m: any) => [m.plant_id, m.plant_name]));
  const newPlantIds = new Set<string>();
  for (const [, state] of currentState) {
    if (state.plant_id && !knownPlantNames.has(state.plant_id)) newPlantIds.add(state.plant_id);
  }
  if (newPlantIds.size > 0) {
    try {
      const result = await nocodb.list('Plants', {
        where: `(Id,in,${[...newPlantIds].join(',')})`,
        fields: ['Id', 'Canonical_Name'],
        limit: newPlantIds.size + 10,
      });
      for (const p of result.list) knownPlantNames.set(p.Id, p.Canonical_Name ?? p.Id);
    } catch { /* use slug as fallback */ }
  }

  // Build corrected matches: use live Plant_Id from NocoDB (handles reassignments),
  // filter out images that have been fully acted on (variety accepted, hidden, triage).
  const allMatches: any[] = [];
  for (const m of rawMatches) {
    const state = currentState.get(m.image_id);
    if (!state) { allMatches.push(m); continue; }
    if (state.variety_id) continue; // Variety accepted — done
    if (state.status === 'hidden' || state.status === 'triage') continue; // Hidden or sent to triage
    // If plant was reassigned, update the match to group under the new plant
    if (state.plant_id && state.plant_id !== m.plant_id) {
      allMatches.push({ ...m, plant_id: state.plant_id, plant_name: knownPlantNames.get(state.plant_id) ?? state.plant_id });
    } else {
      allMatches.push(m);
    }
  }
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
  // Look up the variety's parent plant — if it differs from the image's Plant_Id, update both
  const update: Record<string, any> = { Variety_Id: variety_id };
  try {
    const variety = await nocodb.get('Varieties', variety_id);
    if (variety?.Plant_Id) {
      const image = await nocodb.get('Images', image_id);
      if (image && image.Plant_Id !== variety.Plant_Id) {
        update.Plant_Id = variety.Plant_Id;
        update.Status = 'assigned';
      }
    }
  } catch { /* non-fatal — still set variety */ }

  const updateResult = await nocodb.update('Images', image_id, update);
  console.log(`[accept-variety] image ${image_id} → variety ${variety_id}, update:`, JSON.stringify(update), 'result:', JSON.stringify(updateResult));
  res.json({
    success: true,
    undo_token: { type: 'accept-variety', image_id, variety_id, previous_variety_id: null },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/unmatched-images — Images with plant but no variety
//   ?plant=id  → items for that plant
//   no param   → grouped counts by plant
// ══════════════════════════════════════════════════════════════════════════════
router.get('/unmatched-images', asyncHandler(async (req, res) => {
  const plantParam = req.query.plant as string | undefined;

  if (plantParam !== undefined) {
    const items = await fetchAllPages('Images', {
      where: `(Plant_Id,eq,${plantParam})~and(Variety_Id,blank)~and(Excluded,neq,true)~and(Status,neq,hidden)~and(Status,neq,triage)`,
      fields: ['Id', 'File_Path', 'Plant_Id', 'Caption', 'Original_Filepath', 'Source_Directory', 'Size_Bytes'],
    });
    res.json({ plant_id: plantParam, total: items.length, items });
    return;
  }

  // Aggregate counts by plant
  const counts = new Map<string, number>();
  let offset = 0;
  while (true) {
    const result = await nocodb.list('Images', {
      where: '(Variety_Id,blank)~and(Plant_Id,isnot,null)~and(Excluded,neq,true)~and(Status,neq,hidden)~and(Status,neq,triage)',
      fields: ['Plant_Id'],
      limit: 200,
      offset,
    });
    for (const img of result.list) {
      if (img.Plant_Id) counts.set(img.Plant_Id, (counts.get(img.Plant_Id) || 0) + 1);
    }
    if (result.pageInfo?.isLastPage || result.list.length === 0) break;
    offset += 200;
  }

  const groups = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([plant_id, count]) => ({ plant_id, count }));
  const total = groups.reduce((s, g) => s + g.count, 0);
  res.json({ total, groups });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/unassigned-images — Images with no plant assignment
//   ?offset=N&limit=N for pagination
// ══════════════════════════════════════════════════════════════════════════════
router.get('/unassigned-images-list', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
  const qOffset = parseInt(req.query.offset as string) || 0;

  const result = await nocodb.list('Images', {
    where: '(Plant_Id,blank)~and(Excluded,neq,true)~and(Status,neq,hidden)~and(Status,neq,triage)',
    fields: ['Id', 'File_Path', 'Caption', 'Original_Filepath', 'Source_Directory', 'Size_Bytes'],
    limit,
    offset: qOffset,
  });
  res.json({
    total: result.pageInfo?.totalRows ?? result.list.length,
    offset: qOffset,
    limit,
    items: result.list,
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/hidden-images — All hidden images grouped by plant
//   No ?plant → return plant groups
//   ?plant=id → return items for that plant
//   ?plant=__none__ → return items with no plant
// ══════════════════════════════════════════════════════════════════════════════
router.get('/hidden-images', asyncHandler(async (req, res) => {
  const plantParam = req.query.plant as string | undefined;

  if (plantParam !== undefined) {
    const where = plantParam === '__none__'
      ? '(Status,eq,hidden)~and(Plant_Id,blank)'
      : `(Status,eq,hidden)~and(Plant_Id,eq,${plantParam})`;
    const items = await fetchAllPages('Images', {
      where,
      fields: ['Id', 'File_Path', 'Plant_Id', 'Caption', 'Original_Filepath', 'Size_Bytes', 'Variety_Id'],
    });
    res.json({ plant_id: plantParam, total: items.length, items });
    return;
  }

  // Aggregate by plant
  const counts = new Map<string, number>();
  let noPlantCount = 0;
  let offset = 0;
  while (true) {
    const result = await nocodb.list('Images', {
      where: '(Status,eq,hidden)',
      fields: ['Plant_Id'],
      limit: 200,
      offset,
    });
    for (const img of result.list) {
      if (img.Plant_Id) counts.set(img.Plant_Id, (counts.get(img.Plant_Id) || 0) + 1);
      else noPlantCount++;
    }
    if (result.pageInfo?.isLastPage || result.list.length === 0) break;
    offset += 200;
  }

  const groups = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([plant_id, count]) => ({ plant_id, plant_name: plant_id, count }));
  if (noPlantCount > 0) groups.push({ plant_id: '__none__', plant_name: '(No Fruit)', count: noPlantCount });
  const total = groups.reduce((s, g) => s + g.count, 0);
  res.json({ total, groups });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/search-images — Search images by query across all images
//   ?q=search_term — searches filename, Original_Filepath, Caption, Plant_Id
//   Returns { assigned: [...grouped by plant], unassigned: [...] }
// ══════════════════════════════════════════════════════════════════════════════
router.get('/search-images', asyncHandler(async (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (q.length < 2) { res.json({ assigned: [], unassigned: [], total: 0 }); return; }

  // Search across multiple fields using OR conditions
  const searchFields = ['File_Path', 'Original_Filepath', 'Caption', 'Plant_Id'];
  const conditions = searchFields.map(f => `(${f},like,%${q}%)`).join('~or');

  const allResults: any[] = [];
  let offset = 0;
  while (true) {
    const result = await nocodb.list('Images', {
      where: `(${conditions})~and(Excluded,neq,true)~and(Status,neq,hidden)~and(Status,neq,triage)`,
      limit: 200,
      offset,
    });
    allResults.push(...result.list);
    if (result.pageInfo?.isLastPage || result.list.length === 0 || allResults.length >= 500) break;
    offset += 200;
  }

  // Split into assigned (has Plant_Id) and unassigned
  const assigned: any[] = [];
  const unassigned: any[] = [];
  for (const img of allResults) {
    if (img.Plant_Id) assigned.push(img);
    else unassigned.push(img);
  }

  // Group assigned by Plant_Id
  const groupMap = new Map<string, any[]>();
  for (const img of assigned) {
    if (!groupMap.has(img.Plant_Id)) groupMap.set(img.Plant_Id, []);
    groupMap.get(img.Plant_Id)!.push(img);
  }
  const assignedGroups = [...groupMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([plant_id, images]) => ({ plant_id, images }));

  res.json({ assigned: assignedGroups, unassigned, total: allResults.length });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/dedup-review — Dedup review: deleted vs kept groups
//   ?offset=N&limit=N for pagination
// ══════════════════════════════════════════════════════════════════════════════
router.get('/dedup-review', asyncHandler(async (req, res) => {
  if (!existsSync(DEDUP_REVIEW_JSON)) {
    res.json({ total: 0, groups: [] });
    return;
  }
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(DEDUP_REVIEW_JSON, 'utf-8')); } catch {
    res.json({ total: 0, groups: [] });
    return;
  }
  const allGroups: any[] = parsed.groups || [];
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 50;
  const page = allGroups.slice(offset, offset + limit);

  // Enrich kept records with live NocoDB data, matched by file_path (stable across re-inserts).
  // Fetch by plant_id (a handful per page) then do in-memory file_path lookup.
  const plantIds = new Set<string>();
  for (const g of page) for (const k of (g.kept || [])) if (k.plant_id) plantIds.add(k.plant_id);

  const liveByPath = new Map<string, { Id: number; Status: string; Plant_Id: string | null; Variety_Id: number | null }>();
  for (const plantId of plantIds) {
    try {
      const result = await nocodb.list('Images', {
        where: `(Plant_Id,eq,${plantId})`,
        fields: ['Id', 'File_Path', 'Status', 'Plant_Id', 'Variety_Id'],
        limit: 200,
      });
      for (const r of result.list) {
        if (r.File_Path) liveByPath.set(r.File_Path, { Id: r.Id, Status: r.Status, Plant_Id: r.Plant_Id ?? null, Variety_Id: r.Variety_Id ?? null });
      }
    } catch { /* fall back to JSON data */ }
  }

  const enrichedPage = page.map((g: any) => ({
    ...g,
    kept: (g.kept || []).map((k: any) => {
      const live = liveByPath.get(k.file_path);
      if (!live) return k;
      return { ...k, id: live.Id, status: live.Status ?? k.status, plant_id: live.Plant_Id ?? k.plant_id, variety_id: live.Variety_Id ?? k.variety_id };
    }),
  }));

  res.json({ total: allGroups.length, offset, limit, groups: enrichedPage });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/dedup-restore — Restore a deleted dedup record
//   Re-creates the NocoDB record by copying from source and updating DB
// ══════════════════════════════════════════════════════════════════════════════
router.post('/dedup-restore', requireAdmin, asyncHandler(async (req, res) => {
  const { deleted_record } = req.body as { deleted_record: any };
  if (!deleted_record || !deleted_record.id) {
    res.status(400).json({ error: 'deleted_record with id required' });
    return;
  }

  // Find the original file from the dedup review data
  let origPath: string | null = null;
  if (existsSync(DEDUP_REVIEW_JSON)) {
    const parsed = JSON.parse(readFileSync(DEDUP_REVIEW_JSON, 'utf-8'));
    for (const group of parsed.groups || []) {
      const found = group.deleted.find((d: any) => d.id === deleted_record.id);
      if (found) { origPath = group.original_filepath; break; }
    }
  }

  if (!origPath) {
    res.status(404).json({ error: 'Could not find original filepath for this record' });
    return;
  }

  const srcAbs = path.resolve(PROJECT_ROOT, origPath);
  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: 'Source file not found on disk', path: origPath });
    return;
  }

  const plantId = deleted_record.plant_id;
  if (!plantId) {
    res.status(400).json({ error: 'No plant_id on deleted record' });
    return;
  }

  // Copy source to assigned folder
  const destDir = path.join(config.IMAGE_MOUNT_PATH, plantId, 'images');
  mkdirSync(destDir, { recursive: true });
  const filename = path.basename(origPath);
  const safeFilename = resolveDestFilename(destDir, filename);
  const destAbs = path.join(destDir, safeFilename);
  copyFileSync(srcAbs, destAbs);

  // Create NocoDB record
  const filePath = `content/pass_01/assigned/${plantId}/images/${safeFilename}`;
  const { size: sizeBytes } = statSync(destAbs);
  const record: Record<string, any> = {
    File_Path: filePath,
    Plant_Id: plantId,
    Caption: deleted_record.caption || path.basename(filename, path.extname(filename)),
    Original_Filepath: origPath,
    Size_Bytes: sizeBytes,
    Status: 'assigned',
    Excluded: false,
  };
  if (deleted_record.variety_id) record.Variety_Id = deleted_record.variety_id;

  const created = await nocodb.create('Images', record);
  res.json({ success: true, new_id: created?.Id, file_path: filePath });
}));

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/matches/lost-images — Recovered lost images grouped by plant
//   No ?plant  → return plant groups only
//   ?plant=id  → return items for that plant
// ══════════════════════════════════════════════════════════════════════════════
router.get('/lost-images', asyncHandler(async (req, res) => {
  if (!existsSync(LOST_IMAGES_JSON)) {
    res.json({ total: 0, groups: [] });
    return;
  }
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(LOST_IMAGES_JSON, 'utf-8')); } catch {
    res.json({ total: 0, groups: [] });
    return;
  }
  const rawItems: any[] = (parsed.lost_images || []).filter((i: any) => i.status === 'recovered');

  // Filter out images the user has explicitly dismissed from this tab (tracked in SQLite)
  const dismissedRows = db.prepare('SELECT image_id FROM recovered_dismissed').all() as { image_id: number }[];
  const dismissedSet = new Set(dismissedRows.map(r => r.image_id));
  const allItems = rawItems.filter((i: any) => !dismissedSet.has(i.image_id));

  const plantParam = req.query.plant as string | undefined;

  if (plantParam !== undefined) {
    const jsonItems = allItems.filter((i: any) => i.plant_id === plantParam);

    // Enrich with live NocoDB data — JSON's new_file_path may be stale after slug remaps
    const ids = jsonItems.map((i: any) => i.image_id as number).filter(Boolean);
    const liveMap = new Map<number, any>();
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const result = await nocodb.list('Images', {
          where: `(Id,in,${batch.join(',')})`,
          fields: ['Id', 'File_Path', 'Plant_Id', 'Status', 'Variety_Id', 'Caption'],
          limit: 100,
        });
        for (const r of result.list) liveMap.set(r.Id, r);
      } catch { /* fall back to JSON data */ }
    }

    const items = jsonItems.map((i: any) => {
      const live = liveMap.get(i.image_id);
      return {
        ...i,
        // Use live File_Path if available (corrects stale paths after slug remaps)
        new_file_path: live?.File_Path ?? i.new_file_path,
        status: live?.Status ?? i.status,
        plant_id: live?.Plant_Id ?? i.plant_id,
      };
    });

    res.json({ plant_id: plantParam, plant_name: items[0]?.plant_name ?? plantParam, total: items.length, items });
    return;
  }

  const groupMap = new Map<string, { plant_name: string; count: number }>();
  for (const i of allItems) {
    if (!groupMap.has(i.plant_id)) groupMap.set(i.plant_id, { plant_name: i.plant_name, count: 0 });
    groupMap.get(i.plant_id)!.count++;
  }
  const groups = [...groupMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([plant_id, { plant_name, count }]) => ({ plant_id, plant_name, count }));

  res.json({ total: allItems.length, groups });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/matches/dismiss-lost-images — Mark recovered images as reviewed/dismissed
//   Body: { image_ids: number[] }
// ══════════════════════════════════════════════════════════════════════════════
router.post('/dismiss-lost-images', requireAdmin, asyncHandler(async (req, res) => {
  const { image_ids } = req.body as { image_ids: number[] };
  if (!Array.isArray(image_ids) || image_ids.length === 0) {
    res.status(400).json({ error: 'image_ids array required' });
    return;
  }
  const insert = db.prepare('INSERT OR IGNORE INTO recovered_dismissed (image_id) VALUES (?)');
  const insertMany = db.transaction((ids: number[]) => { for (const id of ids) insert.run(id); });
  insertMany(image_ids);
  res.json({ success: true, dismissed: image_ids.length });
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

  // Look up each variety's parent plant to fix Plant_Id mismatches
  const varietyPlantMap = new Map<number, string>();
  const uniqueVarietyIds = [...new Set(items.map(i => i.variety_id))];
  for (const vid of uniqueVarietyIds) {
    try {
      const v = await nocodb.get('Varieties', vid);
      if (v?.Plant_Id) varietyPlantMap.set(vid, v.Plant_Id);
    } catch { /* skip */ }
  }

  const updates = items.map(i => {
    const update: Record<string, any> = { Id: i.image_id, Variety_Id: i.variety_id };
    const correctPlant = varietyPlantMap.get(i.variety_id);
    if (correctPlant) update.Plant_Id = correctPlant;
    return update;
  });

  for (let i = 0; i < updates.length; i += 100) {
    const result = await nocodb.bulkUpdate('Images', updates.slice(i, i + 100));
    console.log(`[bulk-accept-variety] batch ${i}-${i + updates.slice(i, i + 100).length} result:`, JSON.stringify(result));
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

// ── Attachment OCR routes ────────────────────────────────────────────────────

const ATTACHMENT_OCR_JSON = path.resolve(PROJECT_ROOT, 'content/parsed/attachment_ocr_results.json');

function loadAttachmentOcr(): any[] {
  if (!existsSync(ATTACHMENT_OCR_JSON)) return [];
  try {
    const data = JSON.parse(readFileSync(ATTACHMENT_OCR_JSON, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// GET /api/matches/attachment-ocr — list plants with OCR data
router.get('/attachment-ocr', requireAdmin, asyncHandler(async (req, res) => {
  const results = loadAttachmentOcr();
  if (results.length === 0) {
    return res.json({ total: 0, groups: [] });
  }

  // Load decisions from SQLite
  const decisionRows = db.prepare(
    'SELECT file_path, field_key, action FROM attachment_ocr_decisions'
  ).all() as { file_path: string; field_key: string; action: string }[];
  const decisionsByFile = new Map<string, Record<string, string>>();
  for (const row of decisionRows) {
    if (!decisionsByFile.has(row.file_path)) decisionsByFile.set(row.file_path, {});
    decisionsByFile.get(row.file_path)![row.field_key] = row.action;
  }

  // Group by plant
  const byPlant = new Map<string, any[]>();
  for (const r of results) {
    if (!r.extraction) continue;
    if (!byPlant.has(r.plant_id)) byPlant.set(r.plant_id, []);
    byPlant.get(r.plant_id)!.push(r);
  }

  // Fetch plant names from NocoDB
  const plantIds = [...byPlant.keys()];
  const plantNames = new Map<string, string>();
  try {
    for (let i = 0; i < plantIds.length; i += 50) {
      const batch = plantIds.slice(i, i + 50);
      const whereClause = batch.map(id => `(Id1,eq,${id})`).join('~or');
      const rows = await fetchAllPages('Plants', { where: whereClause, fields: ['Id1', 'Canonical_Name'] });
      for (const row of rows) {
        plantNames.set(row.Id1, row.Canonical_Name);
      }
    }
  } catch (err) {
    console.warn('[attachment-ocr] Could not fetch plant names:', err);
  }

  // Build groups with pending count
  const groups = [];
  for (const [plantId, items] of byPlant) {
    // Count fields that still need a decision
    let totalFields = 0;
    let decidedFields = 0;
    for (const item of items) {
      const dec = decisionsByFile.get(item.file_path) ?? {};
      const e = item.extraction;
      if (!e) continue;
      const fields = [
        e.scientific_name && 'scientific_name',
        e.description && 'description',
        e.origin && 'origin',
        ...(e.nutrition || []).map((n: any) => `nutrition:${n.nutrient}`),
        ...(e.varieties || []).map((v: any) => `variety:${v.name}`),
        ...(e.key_facts || []).map((f: any) => `fact:${f.field}`),
      ].filter(Boolean) as string[];
      totalFields += fields.length;
      decidedFields += fields.filter(f => dec[f]).length;
    }
    groups.push({
      plant_id: plantId,
      plant_name: plantNames.get(plantId) ?? plantId,
      count: items.length,
      pending: totalFields - decidedFields,
    });
  }

  groups.sort((a, b) => b.pending - a.pending || a.plant_id.localeCompare(b.plant_id));

  res.json({ total: results.length, groups });
}));

// GET /api/matches/attachment-ocr-plant/:plantId — get OCR results for a plant
router.get('/attachment-ocr-plant/:plantId', requireAdmin, asyncHandler(async (req, res) => {
  const { plantId } = req.params;
  const results = loadAttachmentOcr().filter(r => r.plant_id === plantId && r.extraction);

  // Load decisions
  const filePaths = results.map(r => r.file_path);
  const decisionsByFile = new Map<string, Record<string, string>>();
  if (filePaths.length > 0) {
    const placeholders = filePaths.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT file_path, field_key, action FROM attachment_ocr_decisions WHERE file_path IN (${placeholders})`
    ).all(...filePaths) as { file_path: string; field_key: string; action: string }[];
    for (const row of rows) {
      if (!decisionsByFile.has(row.file_path)) decisionsByFile.set(row.file_path, {});
      decisionsByFile.get(row.file_path)![row.field_key] = row.action;
    }
  }

  // Fetch plant from NocoDB
  let existingPlant: any = null;
  let existingVarieties: any[] = [];
  try {
    const plantRows = await nocodb.list('Plants', {
      where: `(Id1,eq,${plantId})`,
      fields: ['Id', 'Id1', 'Canonical_Name', 'Botanical_Names', 'Alternative_Names', 'Description', 'Origin', 'Primary_Use', 'Distribution', 'Elevation_Range', 'Culinary_Regions'],
      limit: 1,
    });
    existingPlant = plantRows.list?.[0] ?? null;

    if (existingPlant) {
      existingVarieties = await fetchAllPages('Varieties', {
        where: `(Plant_Id,eq,${plantId})`,
        fields: ['Id', 'Name', 'Alternative_Name'],
      });
    }
  } catch (err) {
    console.warn('[attachment-ocr-plant] NocoDB fetch failed:', err);
  }

  const enriched = results.map(r => ({
    ...r,
    decisions: decisionsByFile.get(r.file_path) ?? {},
  }));

  res.json({
    plant_id: plantId,
    plant_name: existingPlant?.Canonical_Name ?? plantId,
    existing_plant: existingPlant,
    existing_varieties: existingVarieties.map((v: any) => ({
      id: v.Id,
      name: v.Name,
      alternative_name: v.Alternative_Name ?? null,
    })),
    results: enriched,
  });
}));

// POST /api/matches/accept-ocr-field — accept a field and apply to NocoDB
router.post('/accept-ocr-field', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, field_key, plant_id, field_type, value } = req.body;
  if (!file_path || !field_key || !plant_id || !field_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Record decision
  db.prepare(
    'INSERT OR REPLACE INTO attachment_ocr_decisions (file_path, field_key, action) VALUES (?, ?, ?)'
  ).run(file_path, field_key, 'accepted');

  // Apply to NocoDB
  try {
    // Find plant by Id1
    const plantRows = await nocodb.list('Plants', {
      where: `(Id1,eq,${plant_id})`,
      fields: ['Id', 'Id1'],
      limit: 1,
    });
    const plant = plantRows.list?.[0];
    if (!plant) return res.status(404).json({ error: 'Plant not found' });

    if (field_type === 'plant_field') {
      // Map field_key to NocoDB column name
      const FIELD_MAP: Record<string, string> = {
        scientific_name: 'Botanical_Names',
        description: 'Description',
        origin: 'Origin',
      };
      const column = FIELD_MAP[field_key];
      if (!column) return res.status(400).json({ error: `Unknown field: ${field_key}` });

      await nocodb.update('Plants', plant.Id, { [column]: value });
    } else if (field_type === 'key_fact') {
      // Append to Description or create a new field based on fact name
      // For now, we store key facts that don't map to specific fields in Notes/Description
      // This is a best-effort mapping
      const factFieldMap: Record<string, string> = {
        'elevation': 'Elevation_Range',
        'elevation range': 'Elevation_Range',
        'origin': 'Origin',
        'distribution': 'Distribution',
        'primary use': 'Primary_Use',
        'culinary use': 'Culinary_Regions',
      };
      const normalizedField = field_key.toLowerCase().replace(/^fact:/, '');
      const column = factFieldMap[normalizedField];
      if (column) {
        await nocodb.update('Plants', plant.Id, { [column]: value });
      }
      // If no direct mapping, we just record the decision without updating NocoDB
    } else if (field_type === 'nutrition') {
      // Nutrition facts go to Nutritional_Info table
      // Find or create record for this plant
      const nutrientName = field_key.replace(/^nutrition:/, '');
      const existingNutrition = await nocodb.list('Nutritional_Info', {
        where: `(Plant_Id,eq,${plant_id})~and(Nutrient,eq,${nutrientName})`,
        limit: 1,
      });
      if (existingNutrition.list?.length === 0) {
        await nocodb.create('Nutritional_Info', {
          Plant_Id: plant_id,
          Nutrient: nutrientName,
          Value: value,
          Source: 'Attachment OCR',
        });
      }
    }
  } catch (err) {
    console.warn('[accept-ocr-field] NocoDB update failed:', err);
    // Still return success — decision is recorded locally
  }

  res.json({ success: true });
}));

// POST /api/matches/accept-ocr-variety — add a variety to NocoDB
router.post('/accept-ocr-variety', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, field_key, plant_id, variety_name, variety_notes } = req.body;
  if (!file_path || !field_key || !plant_id || !variety_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Record decision
  db.prepare(
    'INSERT OR REPLACE INTO attachment_ocr_decisions (file_path, field_key, action) VALUES (?, ?, ?)'
  ).run(file_path, field_key, 'accepted');

  // Create variety in NocoDB
  try {
    await nocodb.create('Varieties', {
      Name: variety_name,
      Plant_Id: plant_id,
      Alternative_Name: variety_notes ?? null,
      Source: 'Attachment OCR',
    });
  } catch (err) {
    console.warn('[accept-ocr-variety] NocoDB create failed:', err);
  }

  res.json({ success: true });
}));

// POST /api/matches/ignore-ocr-field — mark a field as ignored
router.post('/ignore-ocr-field', requireAdmin, asyncHandler(async (req, res) => {
  const { file_path, field_key } = req.body;
  if (!file_path || !field_key) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.prepare(
    'INSERT OR REPLACE INTO attachment_ocr_decisions (file_path, field_key, action) VALUES (?, ?, ?)'
  ).run(file_path, field_key, 'ignored');

  res.json({ success: true });
}));

// ── GET /api/matches/swap-candidates ─────────────────────────────────────────
// Serves the phash-swap-candidates.json produced by find-phash-swap-candidates.mjs.
// Query params: resolution=triage_higher|assigned_higher|similar|all (default all)
//               offset, limit
router.get('/swap-candidates', asyncHandler(async (req, res) => {
  const jsonPath = path.resolve(PROJECT_ROOT, 'content/backups/phash-swap-candidates.json');
  if (!existsSync(jsonPath)) {
    res.json({ candidates: [], totals: {}, generated_at: null, threshold: null });
    return;
  }
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const { resolution, offset: oq, limit: lq } = req.query as Record<string, string>;
  const offset = Math.max(0, parseInt(oq) || 0);
  const limit  = Math.min(200, Math.max(1, parseInt(lq) || 50));

  let list = data.candidates as any[];
  if (resolution && resolution !== 'all') {
    list = list.filter((c: any) => c.resolution === resolution);
  }

  res.json({
    generated_at: data.generated_at,
    threshold:    data.threshold,
    totals:       data.totals,
    total:        list.length,
    offset,
    limit,
    candidates:   list.slice(offset, offset + limit),
  });
}));

export default router;
