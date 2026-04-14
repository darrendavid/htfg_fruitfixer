// Audit: which attachment files have been OCR'd vs which still need it
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Load Phase 6 OCR extractions
const ocr = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/phase6_ocr_extractions.json'), 'utf-8'));
const ocrExtractions = ocr.extractions || [];

// Build index: basename (lowercase) → extraction record
const ocrByBasename = new Map();
for (const e of ocrExtractions) {
  const p = (e.source_path || e.rel_path || '').split('\\').join('/');
  const bn = path.basename(p).toLowerCase();
  ocrByBasename.set(bn, e);
}

// Walk a directory recursively
function walk(dir, results = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, results);
      else results.push(full);
    }
  } catch { /* skip unreadable */ }
  return results;
}

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff']);
const DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt']);

// Collect all attachment files by plant
const assignedDir = path.join(ROOT, 'content/pass_01/assigned');
const imageAttachments = [];
const docAttachments = [];

for (const plant of readdirSync(assignedDir)) {
  const attDir = path.join(assignedDir, plant, 'attachments');
  if (!existsSync(attDir)) continue;
  for (const file of walk(attDir)) {
    const ext = path.extname(file).toLowerCase();
    const entry = { plant, file, basename: path.basename(file) };
    if (IMG_EXTS.has(ext)) imageAttachments.push(entry);
    else if (DOC_EXTS.has(ext)) docAttachments.push(entry);
  }
}

// Match images to OCR extractions by basename
const matched = imageAttachments.filter(a => ocrByBasename.has(a.basename.toLowerCase()));
const unmatched = imageAttachments.filter(a => !ocrByBasename.has(a.basename.toLowerCase()));

console.log('=== ATTACHMENT OCR COVERAGE AUDIT ===\n');
console.log(`Total attachment files on disk: ${imageAttachments.length + docAttachments.length}`);
console.log(`  Images (JPG/PNG/GIF etc): ${imageAttachments.length}`);
console.log(`  Documents (PDF/DOC/PPT/XLS): ${docAttachments.length}`);
console.log();
console.log(`Phase 6 OCR records: ${ocrExtractions.length} (run March 2026 on website/original source dirs)`);
console.log(`  Attachment images matched by filename to Phase 6 OCR: ${matched.length}`);
console.log(`  Attachment images NOT in Phase 6 OCR: ${unmatched.length}`);
console.log(`  Documents (never OCR'd — not images): ${docAttachments.length}`);
console.log();

if (unmatched.length > 0) {
  console.log('--- IMAGES not previously OCRd ---');
  for (const a of unmatched.sort((a, b) => a.plant.localeCompare(b.plant))) {
    console.log(`  [${a.plant}] ${a.basename}`);
  }
  console.log();
}

console.log('--- DOCUMENTS (all need text extraction) ---');
for (const a of docAttachments.sort((a, b) => a.plant.localeCompare(b.plant))) {
  console.log(`  [${a.plant}] ${a.basename}`);
}
