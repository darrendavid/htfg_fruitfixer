/**
 * Build Website
 *
 * Creates content/website/ from content/source/HawaiiFruit. Net/ with all
 * absolute hawaiifruit.net URLs rewritten to root-relative paths.
 *
 * - HTML files (.html, .htm): rewritten and copied
 * - All other files: hard-linked to originals (zero extra disk space)
 *
 * The rewrite is minimal: only absolute hawaiifruit.net URLs are changed.
 * Internal relative paths (e.g. ThumbnailFrame.html, ../images/fig.jpg)
 * already work correctly and are left untouched.
 *
 * Usage: node scripts/build-website.mjs
 * Re-runnable: skips files that already exist at dest.
 */

import { readFileSync, writeFileSync, mkdirSync, linkSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const ROOT   = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'content', 'source', 'HawaiiFruit. Net');
const DEST   = join(ROOT, 'content', 'website');

const HTML_EXTS = new Set(['.html', '.htm']);

const stats = { dirs: 0, html: 0, linked: 0, skipped: 0, errors: 0 };

// Rewrite absolute hawaiifruit.net URLs to root-relative paths.
// http(s)://[www.]hawaiifruit.net/foo → /foo
// //[www.]hawaiifruit.net/foo         → /foo
function rewriteHtml(content) {
  return content
    .replace(/https?:\/\/(?:www\.)?hawaiifruit\.net\//gi, '/')
    .replace(/\/\/(?:www\.)?hawaiifruit\.net\//gi, '/');
}

function processDir(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  stats.dirs++;

  let entries;
  try {
    entries = readdirSync(srcDir, { withFileTypes: true });
  } catch {
    stats.errors++;
    return;
  }

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);

    if (entry.isDirectory()) {
      processDir(srcPath, dstPath);
      continue;
    }

    if (!entry.isFile()) continue;

    if (existsSync(dstPath)) {
      stats.skipped++;
      continue;
    }

    const ext = extname(entry.name).toLowerCase();

    if (HTML_EXTS.has(ext)) {
      try {
        const content = readFileSync(srcPath, 'utf8');
        const rewritten = rewriteHtml(content);
        writeFileSync(dstPath, rewritten, 'utf8');
        stats.html++;
      } catch {
        stats.errors++;
      }
    } else {
      // Hard link — zero extra disk space, instant
      try {
        linkSync(srcPath, dstPath);
        stats.linked++;
      } catch {
        // Cross-device or other failure — copy as fallback
        try {
          writeFileSync(dstPath, readFileSync(srcPath));
          stats.linked++;
        } catch {
          stats.errors++;
        }
      }
    }
  }
}

console.log('Building content/website/ ...');
console.log('Source:', SOURCE);
console.log('Dest:  ', DEST);
console.log();

const t0 = Date.now();
processDir(SOURCE, DEST);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`Done in ${elapsed}s`);
console.log(`  Directories:    ${stats.dirs}`);
console.log(`  HTML rewritten: ${stats.html}`);
console.log(`  Hard-linked:    ${stats.linked}`);
console.log(`  Skipped:        ${stats.skipped}`);
console.log(`  Errors:         ${stats.errors}`);
