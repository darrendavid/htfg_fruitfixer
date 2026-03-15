/**
 * Phase 3 - Task 2: Fruit Data Pages Extractor
 * Source: content/source/HawaiiFruit. Net/fruitdata/*.html
 * Output: content/parsed/phase3_fruit_data.json
 *
 * Two types of pages:
 *   a) Individual fruit sheets (_abiu.html, etc.)  — QuickNailer-built, minimal HTML:
 *        <TITLE>fruit name</TITLE>
 *        <BODY background="image/foo.jpg"> with a single large <IMG>
 *        navigation links at the bottom
 *   b) Index pages (fruitdata_1of4.html etc.) — thumbnail grid tables
 *        each thumbnail links to a fruit page
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SOURCE_DIR  = resolve(ROOT, 'content/source/HawaiiFruit. Net/fruitdata');
const OUTPUT_FILE = resolve(ROOT, 'content/parsed/phase3_fruit_data.json');
const SOURCE_BASE = 'HawaiiFruit. Net/fruitdata';

/** Convert a fruit filename like "_abiu.html" to "Abiu" */
function nameFromFile(filename) {
  return basename(filename, '.html')
    .replace(/^_/, '')           // strip leading underscore
    .replace(/-/g, ' ')          // hyphens to spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // title-case
}

/** Extract path portion from an absolute hawaiifruit.net URL or return as-is */
function normaliseSrc(src) {
  if (!src) return null;
  return src
    .replace(/^https?:\/\/(?:www\.)?hawaiifruit\.net\//i, '/')
    .trim();
}

function parseFruitPage(filename, html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const sourceRel = `${SOURCE_BASE}/${filename}`;

  // Derive name from title tag, fall back to filename
  const titleText = $('title').text().trim();
  const common_name = titleText
    ? titleText.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : nameFromFile(filename);

  // Collect all images
  const images = [];
  $('img').each((_, el) => {
    const src = normaliseSrc($(el).attr('src'));
    if (src && !images.includes(src)) images.push(src);
  });

  // Background image from BODY tag (the main fruit image)
  const bodyBg = normaliseSrc($('body').attr('background'));
  if (bodyBg && !images.includes(bodyBg)) images.unshift(bodyBg);

  // Navigation links (previous / next / return)
  const nav_links = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text) {
      nav_links.push({ href: normaliseSrc(href), text });
    }
  });

  // Body text — these pages are almost entirely an image with minimal text.
  // Grab any text nodes outside of IMG/A that might contain description.
  const bodyText = $('body').clone()
    .find('img,style,script').remove().end()
    .text()
    .replace(/\s+/g, ' ')
    .trim();

  return {
    type: 'fruit_page',
    common_name,
    title_raw: titleText || null,
    description: bodyText || null,
    images,
    nav_links,
    source_file: sourceRel,
  };
}

function parseIndexPage(filename, html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const sourceRel = `${SOURCE_BASE}/${filename}`;

  const title = $('title').text().trim() || $('caption').first().text().trim() || filename;

  // Each thumbnail cell has: <img> + link text (the fruit name) + file size
  const entries = [];
  $('table td').each((_, td) => {
    const link = $(td).find('a').first();
    const href = link.attr('href');
    if (!href || !href.endsWith('.html')) return;

    const img = $(td).find('img').first();
    const imgSrc = normaliseSrc(img.attr('src'));
    const altText = img.attr('alt') || '';

    // The link text contains the image filename displayed under the thumbnail
    const linkTextLines = link.text().split(/\n+/).map(s => s.trim()).filter(Boolean);
    const displayName = linkTextLines[0] || basename(href, '.html');

    // File size appears as text after the closing </A>
    const allText = $(td).text().replace(/\s+/g, ' ').trim();

    entries.push({
      href: normaliseSrc(href),
      display_name: displayName,
      thumbnail: imgSrc,
      alt_text: altText,
      cell_text: allText,
    });
  });

  // Pagination links
  const page_links = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && href.includes('fruitdata_')) {
      page_links.push({ href, text });
    }
  });

  return {
    type: 'index_page',
    title,
    entry_count: entries.length,
    entries,
    page_links,
    source_file: sourceRel,
  };
}

function main() {
  const files = readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.html') || f.endsWith('.htm'))
    .sort();

  console.log(`Found ${files.length} HTML files in fruitdata/`);

  const records = [];
  let errors = 0;

  for (const filename of files) {
    const filePath = resolve(SOURCE_DIR, filename);
    try {
      const html = readFileSync(filePath, 'latin1');
      let record;
      if (/^fruitdata_\d/.test(filename)) {
        record = parseIndexPage(filename, html);
        console.log(`  [index]  ${filename} — ${record.entry_count} entries`);
      } else {
        record = parseFruitPage(filename, html);
        console.log(`  [fruit]  ${filename} — "${record.common_name}" — ${record.images.length} image(s)`);
      }
      records.push(record);
    } catch (err) {
      console.error(`  ERROR processing ${filename}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nExtracted ${records.length} records (${errors} errors).`);

  const output = {
    extracted_at: new Date().toISOString(),
    source_dir: SOURCE_BASE,
    record_count: records.length,
    records,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Output written to: ${OUTPUT_FILE}`);
}

main();
