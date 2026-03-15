/**
 * Phase 3: Standalone Article / Research Page Extraction
 *
 * Globs all .htm and .html files directly in content/source/HawaiiFruit. Net/
 * (non-recursive), then excludes:
 *   - index* files
 *   - known recipe files (the RECIPE_FILES list)
 *   - Jcitruslist.htm and fruit-time.htm (already parsed in Phase 1)
 *
 * For each remaining file, extracts:
 *   title, body_text, headings[], links[], images[],
 *   embedded_data (variety names, measurements), plant_ids[]
 *
 * Output: content/parsed/phase3_articles.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { existsSync, readdirSync, statSync } from "fs";
import * as cheerio from "cheerio";
import { join, basename, extname } from "path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "content", "source", "HawaiiFruit. Net");
const PARSED = join(ROOT, "content", "parsed");

mkdirSync(PARSED, { recursive: true });

// ── Load plant registry ────────────────────────────────────────────────────
const registryPath = join(PARSED, "plant_registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

function buildPlantIndex(registry) {
  const index = new Map();
  for (const plant of registry.plants) {
    const add = (term) => {
      if (term && term.length > 2) {
        index.set(term.toLowerCase().trim(), plant.id);
      }
    };
    add(plant.common_name);
    for (const alias of plant.aliases || []) add(alias);
    for (const bn of plant.botanical_names || []) add(bn);
  }
  return index;
}

const plantIndex = buildPlantIndex(registry);

function matchPlantIds(texts) {
  const combined = texts.join(" ").toLowerCase();
  const found = new Set();
  for (const [term, id] of plantIndex) {
    if (combined.includes(term)) {
      found.add(id);
    }
  }
  return Array.from(found);
}

// ── Files to exclude ───────────────────────────────────────────────────────
const RECIPE_FILES = new Set([
  "Jaboticaba_Dipping_sauce.htm",
  "KonaLimeSauce.htm",
  "TreeTomatoSauce.htm",
  "Kumquat_Sauce-duck.htm",
  "Starfruit_Banana_Chutney.htm",
  "Tropical_Apricot_Curry_Sa.htm",
  "Pohasalsa.htm",
  "Raspberry_Butter.htm",
  "TropicalApriVinaigrette.htm",
  "candiedzest.htm",
  "CitrusFiveSpiceBurreB.htm",
  "fruitponzu.htm",
  "KumquatGMarmalade.htm",
  "konalimepie.htm",
  "KonaLimePie1.htm",
  "cherimoyaCremeBrulee.htm",
  "Kumquat_Creme-Brulee.htm",
  "LEMONMOUSSENAPOLEON.htm",
  "Mousse.htm",
  "dragonfruitice&juice.htm",
  "dfsorbet.htm",
  "ttsorbet.htm",
  "PineapplePassion.htm",
  "loquatsyrup.htm",
  "jaboticabasyrup.htm",
  "tangy-kitembella-syrup.htm",
  "CoconutSyrup.htm",
  "kerwinskonalimejuice.htm",
  "dragonfruitjuice.htm",
  "rangpur_lime_ade.htm",
  "sweetfigwonton.htm",
  "F_Terrine.htm",
  "Konalime-salmon-canape.htm",
  "Grilled-figs.htm",
  "KonaLimeTequilaCheviche.htm",
  "JackfruitCurry.htm",
  "figwinevenison.htm",
  "grumipilaf.htm",
  "recipet.htm",
  "jellyrecipes.htm",
]);

// Phase 1 files already parsed
const PHASE1_FILES = new Set([
  "fruit-time.htm",
  "Jcitruslist.htm",
]);

// ── Text cleaning ──────────────────────────────────────────────────────────
function cleanText(raw) {
  return raw
    .replace(/[\uFF20\uFFFD\u00A0\uFEFF]/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip all <script>, <style>, and Office XML markup from cheerio doc
 * to improve text extraction quality.
 */
function removeBoilerplate($) {
  $("script, style, head").remove();
  // Remove Office conditional comments content that leaked through
  // (cheerio sometimes includes them as text nodes)
}

/**
 * Extract clean body text as a single string.
 * Joins all non-empty text nodes with space, removing duplicates from
 * nested elements (cheerio .text() gives full recursive text).
 * We walk paragraph-level elements to avoid double-counting.
 */
function extractBodyText($) {
  const parts = [];
  const seen = new Set();

  // Collect top-level block elements
  $("p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote").each((_, el) => {
    const text = cleanText($(el).text());
    if (text && text.length > 2 && !seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  });

  // If no structural elements found, fall back to body text
  if (parts.length === 0) {
    const raw = cleanText($("body").text());
    if (raw) parts.push(raw);
  }

  return parts.join(" ");
}

/**
 * Extract headings as an array of strings.
 */
function extractHeadings($) {
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = cleanText($(el).text());
    if (text) headings.push(text);
  });
  // Also treat bold paragraphs that look like headings (common in Word-to-HTML)
  $("p b, p strong").each((_, el) => {
    const text = cleanText($(el).text());
    const parentText = cleanText($(el).parent().text());
    // If the bold element IS the whole paragraph content, treat as heading
    if (text && text === parentText && text.length < 150) {
      if (!headings.includes(text)) headings.push(text);
    }
  });
  return headings;
}

/**
 * Extract links: { text, url } pairs.
 * Converts absolute http://www.hawaiifruit.net/... URLs to path-only.
 */
function extractLinks($) {
  const links = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    let href = $(el).attr("href") || "";
    const text = cleanText($(el).text());

    // Normalize hawaiifruit.net URLs to path
    href = href.replace(/^https?:\/\/(?:www\.)?hawaiifruit\.net\/?/i, "/");

    // Skip mailto, anchors, empty
    if (!href || href.startsWith("mailto:") || href === "#") return;
    if (seen.has(href)) return;
    seen.add(href);

    links.push({ text: text || href, url: href });
  });
  return links;
}

/**
 * Extract image references.
 */
function extractImages($) {
  const images = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src") || "";
    const alt = $(el).attr("alt") || "";
    if (src) images.push({ src, alt: alt || undefined });
  });
  return images;
}

/**
 * Attempt to extract embedded structured data:
 * - Variety names (e.g. "Sharwil", "Kahaluu", "Hass" from avocado docs)
 * - Measurements (e.g. "760,000 pounds", "12 trees", "350 lbs")
 * - Dates / years
 *
 * Returns an object with arrays.
 */
function extractEmbeddedData(bodyText) {
  const measurements = [];
  const years = [];

  // Measurements: numbers followed by units
  const measRe = /\b(\d[\d,]*(?:\.\d+)?)\s*(lbs?|pounds?|kg|kilograms?|tons?|acres?|trees?|gallons?|oz|ounces?|cups?|tbsp|tsp|inch(?:es)?|ft|feet|miles?|km|%)\b/gi;
  let m;
  while ((m = measRe.exec(bodyText)) !== null) {
    measurements.push(m[0].trim());
  }

  // Years: 4-digit years between 1990 and 2030
  const yearRe = /\b(19[9]\d|20[012]\d)\b/g;
  while ((m = yearRe.exec(bodyText)) !== null) {
    const yr = parseInt(m[1], 10);
    if (!years.includes(yr)) years.push(yr);
  }
  years.sort();

  return {
    measurements: [...new Set(measurements)].slice(0, 30),
    years,
  };
}

// ── Glob root-level .htm/.html files ──────────────────────────────────────
function getRootHtmlFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const name of entries) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      const ext = extname(name).toLowerCase();
      if (ext === ".htm" || ext === ".html") {
        files.push(name);
      }
    }
  }
  return files.sort();
}

// ── Classify / filter files ────────────────────────────────────────────────
function isIndexFile(name) {
  return /^index/i.test(name);
}

function shouldExclude(name) {
  if (isIndexFile(name)) return { exclude: true, reason: "index page" };
  if (RECIPE_FILES.has(name)) return { exclude: true, reason: "recipe" };
  if (PHASE1_FILES.has(name)) return { exclude: true, reason: "phase1-already-parsed" };
  return { exclude: false };
}

// ── Per-file article parser ────────────────────────────────────────────────
function parseArticleFile(filePath, relPath, filename) {
  let html;
  try {
    html = readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Cannot read file: ${e.message}`);
  }

  const $ = cheerio.load(html, { decodeEntities: true });
  removeBoilerplate($);

  // ── Title ────────────────────────────────────────────────────────────────
  // Priority: <meta name=Title>, <title>, first h1/h2, first bold para
  let title =
    $('meta[name="Title"]').attr("content") ||
    $('meta[name="title"]').attr("content") ||
    $("title").text() ||
    "";
  title = cleanText(title);

  if (!title) {
    title = cleanText($("h1, h2").first().text());
  }
  if (!title) {
    // First bold-only paragraph
    const firstBold = $("p b, p strong").first();
    if (firstBold.length) {
      const boldText = cleanText(firstBold.text());
      const parentText = cleanText(firstBold.parent().text());
      if (boldText === parentText) title = boldText;
    }
  }
  if (!title) {
    // Fallback: derive from filename
    title = basename(filename, extname(filename))
      .replace(/[_-]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  // ── Body text ────────────────────────────────────────────────────────────
  const body_text = extractBodyText($);

  // ── Headings ─────────────────────────────────────────────────────────────
  const headings = extractHeadings($);

  // ── Links ────────────────────────────────────────────────────────────────
  const links = extractLinks($);

  // ── Images ───────────────────────────────────────────────────────────────
  const images = extractImages($);

  // ── Embedded data ─────────────────────────────────────────────────────────
  const embedded_data = extractEmbeddedData(body_text);

  // ── Plant ID matching ────────────────────────────────────────────────────
  const plant_ids = matchPlantIds([title, body_text]);

  return {
    title,
    body_text: body_text.substring(0, 50000), // cap at 50k chars per article
    headings: headings.slice(0, 50),
    links: links.slice(0, 100),
    images: images.slice(0, 30),
    embedded_data,
    plant_ids,
    source_file: relPath,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
const allFiles = getRootHtmlFiles(SOURCE);
console.log(`Total .htm/.html files at root: ${allFiles.length}`);

const articleFiles = [];
const skipped = [];

for (const name of allFiles) {
  const { exclude, reason } = shouldExclude(name);
  if (exclude) {
    skipped.push({ name, reason });
  } else {
    articleFiles.push(name);
  }
}

console.log(`Skipped: ${skipped.length} (index: ${skipped.filter(s=>s.reason==="index page").length}, recipes: ${skipped.filter(s=>s.reason==="recipe").length}, phase1: ${skipped.filter(s=>s.reason==="phase1-already-parsed").length})`);
console.log(`Articles to parse: ${articleFiles.length}`);
console.log("");

const articles = [];
let filesProcessed = 0;
let filesErrored = 0;

for (const filename of articleFiles) {
  const filePath = join(SOURCE, filename);
  const relPath = `HawaiiFruit. Net/${filename}`;

  process.stdout.write(`  Parsing: ${filename} ... `);
  try {
    const record = parseArticleFile(filePath, relPath, filename);
    const bodyWords = record.body_text.split(/\s+/).length;
    console.log(`"${record.title.substring(0, 60)}" [${bodyWords}w, plants: ${record.plant_ids.length}]`);
    articles.push(record);
    filesProcessed++;
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    filesErrored++;
  }
}

// ── Write output ───────────────────────────────────────────────────────────
const output = {
  generated: new Date().toISOString(),
  description: "Phase 3 Article extraction from HawaiiFruit.Net root .htm/.html files",
  source_directory: "content/source/HawaiiFruit. Net/",
  files_scanned: allFiles.length,
  files_skipped: skipped.length,
  files_processed: filesProcessed,
  files_errored: filesErrored,
  article_count: articles.length,
  skipped_summary: {
    index_pages: skipped.filter((s) => s.reason === "index page").map((s) => s.name),
    recipe_files: skipped.filter((s) => s.reason === "recipe").map((s) => s.name),
    phase1_files: skipped.filter((s) => s.reason === "phase1-already-parsed").map((s) => s.name),
  },
  articles,
};

const outPath = join(PARSED, "phase3_articles.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log("\n=== Article Extraction Complete ===");
console.log(`  Files scanned   : ${allFiles.length}`);
console.log(`  Files skipped   : ${skipped.length}`);
console.log(`  Files processed : ${filesProcessed}`);
console.log(`  Files errored   : ${filesErrored}`);
console.log(`  Articles output : ${articles.length}`);
console.log(`  Written to      : ${outPath}`);
