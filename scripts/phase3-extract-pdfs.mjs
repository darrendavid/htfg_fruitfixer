#!/usr/bin/env node
/**
 * Phase 3: Extract text from PDFs, EML emails, and TXT files.
 * Outputs:
 *   content/parsed/phase3_pdfs.json
 *   content/parsed/phase3_emails.json
 *   content/parsed/phase3_text_files.json
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative, extname, basename } from 'path';

const require = createRequire(import.meta.url);
const fg = require('fast-glob');
const pdf = require('pdf-parse');

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'content', 'source');
const PARSED = join(ROOT, 'content', 'parsed');

// Load plant registry for matching
const registry = JSON.parse(readFileSync(join(PARSED, 'plant_registry.json'), 'utf-8'));
const plantNames = registry.plants.map(p => ({
  id: p.id,
  names: [p.common_name, ...(p.aliases || []), ...(p.botanical_names || [])].filter(Boolean).map(n => n.toLowerCase()),
}));

function matchPlants(text) {
  const lower = text.toLowerCase();
  const matched = [];
  for (const p of plantNames) {
    for (const name of p.names) {
      if (name.length > 3 && lower.includes(name)) {
        matched.push(p.id);
        break;
      }
    }
  }
  return [...new Set(matched)];
}

// --- PDF Extraction ---
async function extractPDFs() {
  console.log('\n=== PDF Extraction ===');
  const pattern = join(SOURCE, '**/*.{pdf,PDF}').replace(/\\/g, '/');
  const files = await fg(pattern, { dot: false, suppressErrors: true });
  console.log(`Found ${files.length} PDF files`);

  // Deduplicate by size + name
  const seen = new Map();
  const results = [];

  for (const filePath of files.sort()) {
    const relPath = relative(SOURCE, filePath).replace(/\\/g, '/');
    const name = basename(filePath).toLowerCase();
    let size;
    try { size = statSync(filePath).size; } catch { continue; }
    const key = `${size}:${name}`;

    if (seen.has(key)) {
      console.log(`  [SKIP-DUP] ${relPath}`);
      const orig = results.find(r => r.source_file === seen.get(key));
      if (orig) orig.duplicates.push(relPath);
      continue;
    }
    seen.set(key, relPath);

    console.log(`  Processing: ${relPath}`);
    try {
      const buf = readFileSync(filePath);
      const data = await pdf(buf);
      const text = data.text || '';
      const plant_ids = matchPlants(text);

      results.push({
        source_file: relPath,
        title: data.info?.Title || basename(filePath, extname(filePath)),
        pages: data.numpages,
        text_length: text.length,
        text: text.substring(0, 5000), // cap at 5000 chars
        plant_ids,
        quality: text.length > 50 ? 'clean' : text.length > 0 ? 'partial' : 'empty',
        duplicates: [],
      });
      console.log(`    OK: ${data.numpages} pages, ${text.length} chars, ${plant_ids.length} plants`);
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      results.push({
        source_file: relPath,
        title: basename(filePath, extname(filePath)),
        pages: null,
        text_length: 0,
        text: '',
        plant_ids: [],
        quality: 'error',
        error: err.message,
        duplicates: [],
      });
    }
  }

  writeFileSync(join(PARSED, 'phase3_pdfs.json'), JSON.stringify({
    generated: new Date().toISOString(),
    total: results.length,
    quality_summary: {
      clean: results.filter(r => r.quality === 'clean').length,
      partial: results.filter(r => r.quality === 'partial').length,
      empty: results.filter(r => r.quality === 'empty').length,
      error: results.filter(r => r.quality === 'error').length,
    },
    files: results,
  }, null, 2));
  console.log(`\nPDF output: ${results.length} files -> phase3_pdfs.json`);
}

// --- EML Extraction ---
async function extractEmails() {
  console.log('\n=== Email (EML) Extraction ===');
  const pattern = join(SOURCE, '**/*.eml').replace(/\\/g, '/');
  const files = await fg(pattern, { dot: false, suppressErrors: true });
  console.log(`Found ${files.length} EML files`);

  const results = [];
  for (const filePath of files.sort()) {
    const relPath = relative(SOURCE, filePath).replace(/\\/g, '/');
    try {
      const raw = readFileSync(filePath, 'utf-8');
      // Parse headers
      const headerEnd = raw.indexOf('\r\n\r\n');
      const splitPos = headerEnd > -1 ? headerEnd : raw.indexOf('\n\n');
      const headerSection = splitPos > -1 ? raw.substring(0, splitPos) : raw.substring(0, 500);
      const body = splitPos > -1 ? raw.substring(splitPos + (headerEnd > -1 ? 4 : 2)) : '';

      const getHeader = (name) => {
        const match = headerSection.match(new RegExp(`^${name}:\\s*(.+)`, 'mi'));
        return match ? match[1].trim() : null;
      };

      // For multipart MIME, try to get text/plain part
      let bodyText = body;
      const contentType = getHeader('Content-Type') || '';
      if (contentType.includes('multipart')) {
        const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
        if (boundaryMatch) {
          const boundary = boundaryMatch[1];
          const parts = body.split('--' + boundary);
          const textPart = parts.find(p => p.includes('text/plain'));
          if (textPart) {
            const partBodyStart = textPart.indexOf('\r\n\r\n') || textPart.indexOf('\n\n');
            bodyText = partBodyStart > -1 ? textPart.substring(partBodyStart + 4) : textPart;
          }
        }
      }

      // Clean up quoted-printable if present
      bodyText = bodyText.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

      const plant_ids = matchPlants(bodyText + ' ' + (getHeader('Subject') || ''));

      results.push({
        source_file: relPath,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        date: getHeader('Date'),
        body_preview: bodyText.substring(0, 2000).trim(),
        body_length: bodyText.length,
        plant_ids,
      });
    } catch (err) {
      console.log(`  ERROR ${relPath}: ${err.message}`);
      results.push({ source_file: relPath, error: err.message });
    }
  }

  writeFileSync(join(PARSED, 'phase3_emails.json'), JSON.stringify({
    generated: new Date().toISOString(),
    total: results.length,
    files: results,
  }, null, 2));
  console.log(`Email output: ${results.length} files -> phase3_emails.json`);
}

// --- TXT Extraction ---
async function extractTextFiles() {
  console.log('\n=== Text File Extraction ===');
  const pattern = join(SOURCE, '**/*.txt').replace(/\\/g, '/');
  const allFiles = await fg(pattern, { dot: false, suppressErrors: true });
  // Exclude UserSelections.txt (Photoshop metadata)
  const files = allFiles.filter(f => !basename(f).toLowerCase().includes('userselections'));
  console.log(`Found ${files.length} TXT files (excluded UserSelections.txt)`);

  const results = [];
  for (const filePath of files.sort()) {
    const relPath = relative(SOURCE, filePath).replace(/\\/g, '/');
    try {
      const text = readFileSync(filePath, 'utf-8');
      const plant_ids = matchPlants(text + ' ' + relPath);
      results.push({
        source_file: relPath,
        content: text.substring(0, 3000).trim(),
        content_length: text.length,
        plant_ids,
      });
    } catch (err) {
      results.push({ source_file: relPath, error: err.message });
    }
  }

  writeFileSync(join(PARSED, 'phase3_text_files.json'), JSON.stringify({
    generated: new Date().toISOString(),
    total: results.length,
    files: results,
  }, null, 2));
  console.log(`Text output: ${results.length} files -> phase3_text_files.json`);
}

// --- Run all ---
async function main() {
  await extractPDFs();
  await extractEmails();
  await extractTextFiles();
  console.log('\n=== Phase 3 Document Extraction Complete ===');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
