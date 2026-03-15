/**
 * Phase 3 - Task 3: Site Index Pages Extractor
 * Source: content/source/HawaiiFruit. Net/index*.html (root level)
 * Output: content/parsed/phase3_site_index.json
 *
 * These legacy pages share a common pattern:
 *   - No proper <BODY> wrapping elements — content is a flat stream of:
 *       <B><CENTER>Section Heading</CENTER></B><BR>
 *       <LI><A HREF="...">Link text</A>
 *   - Headings are identified as <B><CENTER>...</CENTER></B> blocks
 *   - Links are bare <LI><A> items (no <UL> wrapper in most cases)
 *   - Some pages have <UL> wrappers — we handle both
 *
 * Strategy: Walk all block-level nodes in document order, accumulating links
 * under the most recently seen heading.
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SOURCE_ROOT  = resolve(ROOT, 'content/source/HawaiiFruit. Net');
const OUTPUT_FILE  = resolve(ROOT, 'content/parsed/phase3_site_index.json');
const SOURCE_BASE  = 'HawaiiFruit. Net';

// All index filenames to process (including the one with a space in the name)
const INDEX_FILES = [
  'index.html',
  'index (revised).html',
  'indexavo.html',
  'index-bircd.html',
  'indexdata.html',
  'index-epub.html',
  'index-figs.html',
  'indexgf.html',
  'index-htfg.html',
  'indexindiacof.html',
  'indexjapan.html',
  'indexohelo.html',
  'index-personal.html',
  'indexposter.html',
  'indexpp.html',
  'index-pubs.html',
  'indexrant.html',
  'index-recipes.html',
  'indexstonefruit.html',
  'indexvideo.html',
];

/** Normalise a URL: extract path from absolute hawaiifruit.net URLs, keep external ones */
function normaliseHref(href) {
  if (!href) return null;
  href = href.trim();
  // Strip hawaiifruit.net prefix to get relative path
  const match = href.match(/^https?:\/\/(?:www\.)?hawaiifruit\.net\/(.*)/i);
  if (match) return '/' + match[1];
  return href;
}

/** Return true if a string looks like a section divider (dashes, equals, etc.) */
function isDivider(text) {
  return /^[-=*_\s]{3,}$/.test(text.replace(/[^-=*_\s]/g, ''));
}

/** Clean up heading text — trim, collapse whitespace, remove divider chars */
function cleanHeading(text) {
  return text
    .replace(/[-]{3,}/g, '') // strip long dash runs (dividers embedded in headings)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIndexPage(filename) {
  const filePath = resolve(SOURCE_ROOT, filename);
  const sourceRel = `${SOURCE_BASE}/${filename}`;

  let html;
  try {
    html = readFileSync(filePath, 'latin1');
  } catch (err) {
    console.warn(`  SKIP (not found): ${filename}`);
    return null;
  }

  const $ = cheerio.load(html, { decodeEntities: false, xmlMode: false });

  // Page title from <TITLE> tag, or first meaningful CENTER/B heading
  const titleFromTag = $('title').text().trim();

  // --- Build sections by walking all direct body children in order ---
  // We collect [{ heading, links[] }] groups.

  const sections = [];
  let currentSection = { heading: null, links: [] };

  /**
   * Determine if an element is a heading (bold+centered non-link text)
   * Returns the heading text or null.
   */
  function extractHeading(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (!['b', 'center', 'h1', 'h2', 'h3', 'h4'].includes(tag)) return null;

    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || isDivider(text)) return null;

    // Must NOT be a link itself
    if ($(el).find('a').length > 0) return null;

    // Typical heading pattern: <B><CENTER>...</CENTER></B> or just <B>text</B>
    // Also <CENTER><B>text</B></CENTER>
    // We accept B or CENTER as heading indicators when they contain no links
    return cleanHeading(text) || null;
  }

  /**
   * Extract a link record from an <A> element.
   */
  function extractLink(aEl) {
    const href = $(aEl).attr('href');
    if (!href) return null;
    const text = $(aEl).text().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return {
      url: normaliseHref(href),
      text,
    };
  }

  /**
   * Flush current section if it has content, start a new one.
   */
  function startSection(heading) {
    // Flush previous section if it has links or a named heading
    if (currentSection.links.length > 0 || currentSection.heading) {
      sections.push({ ...currentSection });
    }
    currentSection = { heading, links: [] };
  }

  /**
   * Walk an element recursively looking for <A> links to add to current section.
   */
  function collectLinks(el) {
    if (!el) return;
    if (el.type === 'tag' && el.tagName && el.tagName.toLowerCase() === 'a') {
      const link = extractLink(el);
      if (link) currentSection.links.push(link);
      return; // don't recurse into <a>
    }
    if (el.children) {
      el.children.forEach(child => collectLinks(child));
    }
  }

  // Walk the body's direct children (and handle quirky flat structure)
  // We use a depth-first walk but treat B/CENTER/Hx as potential headings
  // and A elements as links.

  function walkNode(el) {
    if (!el) return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    if (el.type === 'text') return; // plain text nodes – skip

    // Heading candidates
    const heading = extractHeading(el);
    if (heading) {
      startSection(heading);
      return;
    }

    // Direct link (bare <A> or <LI><A>)
    if (tag === 'a') {
      const link = extractLink(el);
      if (link) currentSection.links.push(link);
      return;
    }

    if (tag === 'li') {
      // Walk children — may contain an <A>
      if (el.children) {
        el.children.forEach(child => {
          if (child.tagName && child.tagName.toLowerCase() === 'a') {
            const link = extractLink(child);
            if (link) currentSection.links.push(link);
          }
        });
      }
      return;
    }

    // Recurse into structural containers
    if (['ul', 'ol', 'div', 'p', 'td', 'tr', 'tbody', 'table', 'body'].includes(tag)) {
      if (el.children) el.children.forEach(walkNode);
      return;
    }

    // For any other element (br, img, etc.) — check for children with links
    if (el.children) {
      el.children.forEach(child => {
        if (child.type === 'tag') walkNode(child);
      });
    }
  }

  const body = $('body').get(0);
  if (body && body.children) {
    body.children.forEach(walkNode);
  }

  // Flush final section
  if (currentSection.links.length > 0 || currentSection.heading) {
    sections.push(currentSection);
  }

  // Remove empty sections and sections that are only dividers
  const cleanSections = sections.filter(s => {
    const hasLinks = s.links.length > 0;
    const hasRealHeading = s.heading && !isDivider(s.heading) && s.heading.length > 0;
    return hasLinks || hasRealHeading;
  });

  // Derive page title: use <title> tag if non-trivial, else first heading
  let pageTitle = titleFromTag && titleFromTag.trim().length > 1 ? titleFromTag.trim() : null;
  if (!pageTitle && cleanSections.length > 0) {
    pageTitle = cleanSections[0].heading || filename;
  }
  if (!pageTitle) pageTitle = filename;

  const totalLinks = cleanSections.reduce((sum, s) => sum + s.links.length, 0);

  return {
    page: filename,
    title: pageTitle,
    section_count: cleanSections.length,
    total_links: totalLinks,
    sections: cleanSections,
    source_file: sourceRel,
  };
}

function main() {
  console.log(`Processing ${INDEX_FILES.length} index files...`);

  const records = [];
  let errors = 0;

  for (const filename of INDEX_FILES) {
    try {
      const record = parseIndexPage(filename);
      if (!record) { errors++; continue; }
      records.push(record);
      console.log(`  ${filename.padEnd(30)} "${record.title}" — ${record.section_count} sections, ${record.total_links} links`);
    } catch (err) {
      console.error(`  ERROR ${filename}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nExtracted ${records.length} index pages (${errors} skipped/errored).`);

  // Summary stats
  const totalLinks = records.reduce((s, r) => s + r.total_links, 0);
  console.log(`Total links across all pages: ${totalLinks}`);

  const output = {
    extracted_at: new Date().toISOString(),
    source_dir: SOURCE_BASE,
    page_count: records.length,
    total_links: totalLinks,
    records,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Output written to: ${OUTPUT_FILE}`);
}

main();
