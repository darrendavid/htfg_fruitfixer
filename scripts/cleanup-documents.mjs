import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const parsedDir = path.join(import.meta.dirname, '..', 'content', 'parsed');

// --- Load input files ---
console.log('Loading input files...');

const articles = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_articles.json'), 'utf-8'));
const pdfs = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_pdfs.json'), 'utf-8'));
const textFiles = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_text_files.json'), 'utf-8'));
const emails = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_emails.json'), 'utf-8'));
const aliasMap = JSON.parse(readFileSync(path.join(parsedDir, 'cleanup_alias_map.json'), 'utf-8'));

console.log(`  Articles: ${articles.articles.length}`);
console.log(`  PDFs: ${pdfs.files.length}`);
console.log(`  Text files: ${textFiles.files.length}`);
console.log(`  Emails: ${emails.files ? emails.files.length : 0} (skipping — all zero content)`);

// --- Alias resolution ---
function resolveAlias(plantId) {
  const key = plantId.toLowerCase().replace(/-/g, ' ').trim();
  const entry = aliasMap.aliases[key];
  if (entry) return entry.canonical_id;
  // Also try with hyphens as-is
  const entry2 = aliasMap.aliases[plantId.toLowerCase().trim()];
  if (entry2) return entry2.canonical_id;
  return plantId;
}

function resolvePlantIds(plantIds) {
  if (!plantIds || !Array.isArray(plantIds)) return [];
  const resolved = new Set();
  for (const pid of plantIds) {
    resolved.add(resolveAlias(pid));
  }
  return [...resolved].sort();
}

// --- Helpers ---
function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function contentPreview(text) {
  if (!text) return '';
  return text.slice(0, 300).replace(/\s+/g, ' ').trim();
}

function pdfDocType(sourceFile) {
  const lower = sourceFile.toLowerCase();
  if (lower.includes('poster')) return 'poster';
  if (lower.includes('recipe')) return 'guide';
  return 'research';
}

// --- Process articles ---
console.log('\nProcessing articles...');
const articleDocs = articles.articles.map(a => ({
  title: a.title || '',
  doc_type: 'article',
  content_text: truncate(a.body_text || '', 50000),
  content_preview: contentPreview(a.body_text || ''),
  plant_ids: resolvePlantIds(a.plant_ids),
  original_file_path: a.source_file || '',
  is_plant_related: !!(a.plant_ids && a.plant_ids.length > 0)
}));
console.log(`  Mapped ${articleDocs.length} articles`);

// --- Process PDFs (filter out partial with text_length < 100) ---
console.log('\nProcessing PDFs...');
const filteredPdfs = pdfs.files.filter(p => {
  if (p.quality === 'partial' && (p.text_length || 0) < 100) {
    console.log(`  Excluded (partial, ${p.text_length} chars): ${p.source_file}`);
    return false;
  }
  return true;
});
console.log(`  Kept ${filteredPdfs.length} of ${pdfs.files.length} PDFs`);

const pdfDocs = filteredPdfs.map(p => ({
  title: p.title || '',
  doc_type: pdfDocType(p.source_file || ''),
  content_text: p.text || '',
  content_preview: contentPreview(p.text || ''),
  plant_ids: resolvePlantIds(p.plant_ids),
  original_file_path: p.source_file || '',
  is_plant_related: !!(p.plant_ids && p.plant_ids.length > 0)
}));

// --- Process text files ---
console.log('\nProcessing text files...');
const textDocs = textFiles.files.map(t => ({
  title: path.basename(t.source_file || '', path.extname(t.source_file || '')),
  doc_type: 'text_note',
  content_text: t.content || '',
  content_preview: contentPreview(t.content || ''),
  plant_ids: resolvePlantIds(t.plant_ids),
  original_file_path: t.source_file || '',
  is_plant_related: !!(t.plant_ids && t.plant_ids.length > 0)
}));
console.log(`  Mapped ${textDocs.length} text files`);

// --- Emails: skip entirely ---
const emailCount = emails.files ? emails.files.length : 0;
console.log(`\nSkipping ${emailCount} emails (all zero content)`);

// --- Combine and assign sequential IDs ---
const allDocs = [...articleDocs, ...pdfDocs, ...textDocs];
allDocs.forEach((doc, i) => {
  doc.id = i + 1;
});

// Reorder fields so id comes first
const documents = allDocs.map(doc => ({
  id: doc.id,
  title: doc.title,
  doc_type: doc.doc_type,
  content_text: doc.content_text,
  content_preview: doc.content_preview,
  plant_ids: doc.plant_ids,
  original_file_path: doc.original_file_path,
  is_plant_related: doc.is_plant_related
}));

// --- Stats ---
const withPlantIds = documents.filter(d => d.is_plant_related).length;
const stats = {
  articles: articleDocs.length,
  pdfs: pdfDocs.length,
  text_files: textDocs.length,
  emails_skipped: emailCount,
  total: documents.length,
  with_plant_ids: withPlantIds
};

console.log('\n--- Summary ---');
console.log(`  Articles:       ${stats.articles}`);
console.log(`  PDFs:           ${stats.pdfs}`);
console.log(`  Text files:     ${stats.text_files}`);
console.log(`  Emails skipped: ${stats.emails_skipped}`);
console.log(`  Total docs:     ${stats.total}`);
console.log(`  With plant IDs: ${stats.with_plant_ids}`);

// --- Write output ---
const output = {
  generated: new Date().toISOString(),
  stats,
  documents
};

const outPath = path.join(parsedDir, 'cleanup_documents.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
console.log(`\nWrote ${outPath}`);
