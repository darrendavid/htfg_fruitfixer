import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { config } from '../config.js';
import * as dal from '../lib/dal.js';
import db from '../lib/db.js';
import type { Plant } from '../types.js';

// ── Windows-safe __dirname equivalent ────────────────────────────────────────
const __filename = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const __dirname = path.dirname(__filename);

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipThumbnails = args.includes('--skip-thumbnails');
const dryRun = args.includes('--dry-run');

// ── Paths ─────────────────────────────────────────────────────────────────────
// IMAGE_MOUNT_PATH points to the content/parsed/ directory
// JSON source files live in that same directory
const PARSED_DIR = config.IMAGE_MOUNT_PATH;
const THUMBNAILS_DIR = path.join(PARSED_DIR, '.thumbnails');
const DATA_DIR = path.join(__dirname, '..', 'data');

function jsonPath(filename: string): string {
  return path.join(PARSED_DIR, filename);
}

// ── Progress state (exported for admin API) ───────────────────────────────────
export let importProgress: {
  status: 'idle' | 'running' | 'complete' | 'error';
  step: string;
  progress: number;
  total: number;
  message: string;
} = { status: 'idle', step: '', progress: 0, total: 0, message: '' };

function log(msg: string): void {
  console.log(`[import] ${msg}`);
}

// ── Sort key computation ──────────────────────────────────────────────────────
function confidenceRank(confidence: string | null): number {
  switch (confidence) {
    case 'high':   return 1;
    case 'medium': return 2;
    case 'low':    return 3;
    default:       return 4; // 'auto' or null
  }
}

function computeSwipeSortKeys(
  items: Array<{ image_path: string; suggested_plant_id: string | null; confidence: string | null }>,
): Map<string, string> {
  // Group by suggested_plant_id
  const groups = new Map<string, { bestConfidence: number; paths: Array<{ path: string; confidence: string | null }> }>();

  for (const item of items) {
    const plantId = item.suggested_plant_id || '__no_plant__';
    const cr = confidenceRank(item.confidence);
    if (!groups.has(plantId)) {
      groups.set(plantId, { bestConfidence: cr, paths: [] });
    }
    const g = groups.get(plantId)!;
    if (cr < g.bestConfidence) g.bestConfidence = cr;
    g.paths.push({ path: item.image_path, confidence: item.confidence });
  }

  // Rank plant groups by best confidence, then alphabetically by plantId for stability
  const sortedPlants = Array.from(groups.entries())
    .sort((a, b) => {
      const diff = a[1].bestConfidence - b[1].bestConfidence;
      return diff !== 0 ? diff : a[0].localeCompare(b[0]);
    });

  const sortKeys = new Map<string, string>();
  sortedPlants.forEach(([plantId, group], i) => {
    const groupRank = String(i + 1).padStart(6, '0');
    for (const { path: imagePath, confidence } of group.paths) {
      const cr = confidenceRank(confidence);
      sortKeys.set(imagePath, `${groupRank}:${plantId}:${cr}:${imagePath}`);
    }
  });

  return sortKeys;
}

// ── Thumbnail generation ──────────────────────────────────────────────────────
async function generateThumbnail(sourcePath: string, relativePath: string): Promise<string | null> {
  // Thumbnails are stored as JPEGs regardless of source format
  const thumbRelative = relativePath.replace(/\.[^.]+$/, '.jpg');
  const destPath = path.join(THUMBNAILS_DIR, thumbRelative);
  const destDir = path.dirname(destPath);

  if (fs.existsSync(destPath)) return destPath; // skip if already generated

  try {
    fs.mkdirSync(destDir, { recursive: true });
    await sharp(sourcePath)
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(destPath);
    return destPath;
  } catch {
    // Non-fatal — log at call site, continue import
    return null;
  }
}

// ── Main import function ──────────────────────────────────────────────────────
export async function runImport(options: { skipThumbnails?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const skip = options.skipThumbnails ?? skipThumbnails;
  const dry = options.dryRun ?? dryRun;

  importProgress = { status: 'running', step: 'Step 0/6: Starting', progress: 0, total: 0, message: 'Import started' };

  // ── Step 0: Seed admin user ───────────────────────────────────────────────
  log('Step 0: Seeding admin user...');
  importProgress.step = 'Step 0/6: Seeding admin user';
  importProgress.message = 'Seeding admin user...';
  try {
    const adminUser = dal.upsertAdminUser(config.ADMIN_EMAIL, 'Admin');
    log(`Admin user seeded: ${config.ADMIN_EMAIL} (id=${adminUser.id})`);
  } catch (err) {
    log(`Warning: could not seed admin user: ${err}`);
  }

  // ── Step 1: Import plants from plant_registry.json ────────────────────────
  log('Step 1: Importing plants...');
  importProgress.step = 'Step 1/6: Importing plants';
  importProgress.message = 'Reading plant_registry.json...';

  const registryPath = jsonPath('plant_registry.json');
  if (!fs.existsSync(registryPath)) {
    log(`WARNING: plant_registry.json not found at ${registryPath}`);
  } else {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const plants: Plant[] = (registry.plants || []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      common_name: p.common_name as string,
      botanical_names: Array.isArray(p.botanical_names)
        ? (p.botanical_names as string[]).join(', ')
        : ((p.botanical_names as string | null) ?? null),
      aliases: Array.isArray(p.aliases)
        ? (p.aliases as string[]).join(', ')
        : ((p.aliases as string | null) ?? null),
      category: (p.category as string) || 'fruit',
    }));
    if (!dry) {
      const inserted = dal.bulkInsertPlants(plants);
      log(`Plants: inserted ${inserted} / ${plants.length}`);
    } else {
      log(`[dry-run] Would insert ${plants.length} plants`);
    }
  }

  // ── Step 2: Write CSV candidates from phase4b_new_plants.json ────────────
  log('Step 2: Writing CSV candidates...');
  importProgress.step = 'Step 2/6: Writing CSV candidates';
  importProgress.message = 'Reading phase4b_new_plants.json...';

  const newPlantsPath = jsonPath('phase4b_new_plants.json');
  if (fs.existsSync(newPlantsPath)) {
    const newPlants = JSON.parse(fs.readFileSync(newPlantsPath, 'utf-8'));
    const candidates = newPlants.plants || [];
    if (!dry) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const csvCandidatesPath = path.join(DATA_DIR, 'csv-candidates.json');
      fs.writeFileSync(csvCandidatesPath, JSON.stringify(candidates, null, 2));
      log(`CSV candidates: wrote ${candidates.length} items to ${csvCandidatesPath}`);
    } else {
      log(`[dry-run] Would write ${candidates.length} CSV candidates`);
    }
  } else {
    log(`WARNING: phase4b_new_plants.json not found at ${newPlantsPath}`);
  }

  // ── Step 3: Load inference items from phase4b_inferences.json ────────────
  log('Step 3: Loading inference swipe items...');
  importProgress.step = 'Step 3/6: Loading inferences';
  importProgress.message = 'Reading phase4b_inferences.json...';

  type InferenceItem = {
    image_path: string;
    suggested_plant_id: string | null;
    confidence: string | null;
    match_type: string | null;
    reasoning: string | null;
  };

  const inferenceItems: InferenceItem[] = [];
  const inferencePaths = new Set<string>();

  const inferencesPath = jsonPath('phase4b_inferences.json');
  if (fs.existsSync(inferencesPath)) {
    const inferences = JSON.parse(fs.readFileSync(inferencesPath, 'utf-8'));
    const rows: Record<string, unknown>[] = inferences.inferences || [];
    for (const r of rows) {
      const imagePath = r.path as string;
      inferenceItems.push({
        image_path: imagePath,
        suggested_plant_id: (r.inferred_plant_id as string) || null,
        confidence: (r.confidence as string) || null,
        match_type: (r.match_type as string) || null,
        reasoning: (r.reasoning as string) || null,
      });
      inferencePaths.add(imagePath);
    }
    log(`Inferences loaded: ${inferenceItems.length}`);
  } else {
    log(`WARNING: phase4b_inferences.json not found at ${inferencesPath}`);
  }

  // ── Step 4: Load manifest swipe items from phase4_image_manifest.json ─────
  log('Step 4: Loading manifest swipe items (plant_id != null, not already in inferences)...');
  importProgress.step = 'Step 4/6: Loading image manifest';
  importProgress.message = 'Reading phase4_image_manifest.json...';

  type ManifestItem = {
    image_path: string;
    suggested_plant_id: string;
    confidence: string;
    file_size: number | null;
  };

  const manifestItems: ManifestItem[] = [];

  const manifestPath = jsonPath('phase4_image_manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const files: Record<string, unknown>[] = manifest.files || [];

    for (const f of files) {
      if (!f.plant_id) continue;
      // Prefer the organized destination path; fall back to source path
      const imagePath = (f.dest as string) || (f.source as string);
      if (!imagePath) continue;
      // Skip images already covered by phase4b inferences
      if (inferencePaths.has(imagePath)) continue;
      manifestItems.push({
        image_path: imagePath,
        suggested_plant_id: f.plant_id as string,
        confidence: 'auto',
        file_size: (f.size as number) || null,
      });
    }
    log(`Manifest swipe items loaded: ${manifestItems.length}`);
  } else {
    log(`WARNING: phase4_image_manifest.json not found at ${manifestPath}`);
  }

  // Combine all swipe items and compute sort keys
  const allSwipeItems: Array<{ image_path: string; suggested_plant_id: string | null; confidence: string | null }> = [
    ...inferenceItems,
    ...manifestItems,
  ];
  const swipeSortKeys = computeSwipeSortKeys(allSwipeItems);

  // Build queue records for swipe items
  const swipeRecords = [
    ...inferenceItems.map(item => ({
      image_path: item.image_path,
      source_path: item.image_path,
      queue: 'swipe',
      status: 'pending',
      suggested_plant_id: item.suggested_plant_id,
      confidence: item.confidence,
      match_type: item.match_type,
      reasoning: item.reasoning,
      file_size: null,
      sort_key: swipeSortKeys.get(item.image_path) || null,
      locked_by: null,
    })),
    ...manifestItems.map(item => ({
      image_path: item.image_path,
      source_path: item.image_path,
      queue: 'swipe',
      status: 'pending',
      suggested_plant_id: item.suggested_plant_id,
      confidence: item.confidence,
      match_type: null,
      reasoning: null,
      file_size: item.file_size,
      sort_key: swipeSortKeys.get(item.image_path) || null,
      locked_by: null,
    })),
  ];

  if (!dry) {
    log(`Inserting ${swipeRecords.length} swipe queue items...`);
    const swipeInserted = dal.bulkInsertQueueItems(swipeRecords);
    log(`Swipe queue: inserted ${swipeInserted} / ${swipeRecords.length}`);
  } else {
    log(`[dry-run] Would insert ${swipeRecords.length} swipe items`);
  }

  // ── Step 5: Build classify queue from phase4b_still_unclassified.json ─────
  log('Step 5: Importing classify queue items...');
  importProgress.step = 'Step 5/6: Importing classify queue';
  importProgress.message = 'Reading phase4b_still_unclassified.json...';

  const unclassifiedPath = jsonPath('phase4b_still_unclassified.json');
  if (fs.existsSync(unclassifiedPath)) {
    const unclassified = JSON.parse(fs.readFileSync(unclassifiedPath, 'utf-8'));
    const files: Record<string, unknown>[] = unclassified.files || [];

    const classifyRecords = files.map((f) => {
      const dirs = Array.isArray(f.directories) ? (f.directories as string[]) : [];
      const firstDir = dirs.length > 0 ? dirs[0] : 'unknown';
      const imagePath = f.path as string;
      return {
        image_path: imagePath,
        source_path: imagePath,
        queue: 'classify',
        status: 'pending',
        source_directories: dirs.length > 0 ? dirs.join(',') : null,
        sort_key: `classify:${firstDir}:${imagePath}`,
        locked_by: null,
      };
    });

    if (!dry) {
      log(`Inserting ${classifyRecords.length} classify queue items...`);
      const classifyInserted = dal.bulkInsertQueueItems(classifyRecords);
      log(`Classify queue: inserted ${classifyInserted} / ${classifyRecords.length}`);
    } else {
      log(`[dry-run] Would insert ${classifyRecords.length} classify items`);
    }
  } else {
    log(`WARNING: phase4b_still_unclassified.json not found at ${unclassifiedPath}`);
  }

  // ── Step 6: Generate thumbnails ───────────────────────────────────────────
  if (!skip) {
    log('Step 6: Generating thumbnails...');
    importProgress.step = 'Step 6/6: Generating thumbnails';
    importProgress.total = swipeRecords.length;
    importProgress.message = `0 / ${swipeRecords.length} thumbnails`;

    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

    const updateThumb = db.prepare(
      `UPDATE review_queue SET thumbnail_path = ? WHERE image_path = ?`,
    );

    let thumbCount = 0;
    let thumbErrors = 0;
    let thumbSkipped = 0;

    for (let i = 0; i < swipeRecords.length; i++) {
      const item = swipeRecords[i];
      const imagePath = item.image_path;

      // Resolve full source path (image_path may be absolute or relative to PARSED_DIR)
      const fullSourcePath = path.isAbsolute(imagePath)
        ? imagePath
        : path.join(PARSED_DIR, imagePath);

      if (!fs.existsSync(fullSourcePath)) {
        thumbSkipped++;
        importProgress.progress = i + 1;
        continue;
      }

      const relativePath = path.isAbsolute(imagePath)
        ? path.relative(PARSED_DIR, imagePath)
        : imagePath;

      const thumbPath = await generateThumbnail(fullSourcePath, relativePath);
      if (thumbPath) {
        thumbCount++;
        if (!dry) {
          updateThumb.run(thumbPath, imagePath);
        }
      } else {
        thumbErrors++;
        log(`Thumbnail error for: ${imagePath}`);
      }

      importProgress.progress = i + 1;

      if ((i + 1) % 500 === 0) {
        const msg = `${i + 1} / ${swipeRecords.length} thumbnails (${thumbCount} done, ${thumbErrors} errors, ${thumbSkipped} missing)`;
        log(`Thumbnails: ${msg}`);
        importProgress.message = msg;
      }
    }

    log(
      `Thumbnails complete: ${thumbCount} generated, ` +
      `${thumbErrors} errors, ${thumbSkipped} source files missing`,
    );
  } else {
    log('Step 6: Skipping thumbnails (--skip-thumbnails)');
    importProgress.step = 'Step 6/6: Thumbnails skipped';
    importProgress.message = 'Skipped thumbnail generation';
  }

  // ── Final counts ──────────────────────────────────────────────────────────
  if (!dry) {
    const counts = dal.getImportCounts();
    log('Import complete!');
    log(`  Plants:   ${counts.plants}`);
    log(`  Swipe:    ${counts.swipe}`);
    log(`  Classify: ${counts.classify}`);
    log(`  Total:    ${counts.total}`);
  } else {
    log('[dry-run] Import simulation complete — no data written');
  }

  importProgress = { status: 'complete', step: 'Done', progress: 0, total: 0, message: 'Import complete' };
}

// ── Run when invoked directly (tsx server/scripts/import.ts) ──────────────────
const isMain = process.argv[1] &&
  path.resolve(__filename) === path.resolve(process.argv[1]);

if (isMain) {
  runImport().catch(err => {
    console.error('[import] Fatal error:', err);
    importProgress = { status: 'error', step: 'Error', progress: 0, total: 0, message: String(err) };
    process.exit(1);
  });
}
