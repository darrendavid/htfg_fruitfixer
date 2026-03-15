/**
 * Phase 3: Recipe Page Extraction
 *
 * Parses all recipe .htm files from the root of content/source/HawaiiFruit. Net/
 * Extracts: title, ingredients, method, associated plant_ids, images.
 *
 * Multi-recipe files (jellyrecipes.htm) are split into sub-records.
 *
 * Output: content/parsed/phase3_recipes.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { existsSync } from "fs";
import * as cheerio from "cheerio";
import { join, basename } from "path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "content", "source", "HawaiiFruit. Net");
const PARSED = join(ROOT, "content", "parsed");

mkdirSync(PARSED, { recursive: true });

// ── Load plant registry ────────────────────────────────────────────────────
const registryPath = join(PARSED, "plant_registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

/**
 * Build a lookup map: search term (lower) → plant id
 * Includes: common_name, aliases, botanical_names
 */
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

/**
 * Match plant IDs by searching text for known plant names.
 * Returns deduplicated array of matching plant ids.
 */
function matchPlantIds(texts) {
  const combined = texts.join(" ").toLowerCase();
  const found = new Set();
  for (const [term, id] of plantIndex) {
    // Use word-boundary-like matching: check the term appears as a word/phrase
    // Simple approach: check if combined contains the term
    if (combined.includes(term)) {
      found.add(id);
    }
  }
  return Array.from(found);
}

// ── Exhaustive recipe file list ────────────────────────────────────────────
const RECIPE_FILES = [
  // Sauces / condiments
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
  // Desserts
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
  // Syrups / beverages
  "loquatsyrup.htm",
  "jaboticabasyrup.htm",
  "tangy-kitembella-syrup.htm",
  "CoconutSyrup.htm",
  "kerwinskonalimejuice.htm",
  "dragonfruitjuice.htm",
  "rangpur_lime_ade.htm",
  // Main dishes
  "sweetfigwonton.htm",
  "F_Terrine.htm",
  "Konalime-salmon-canape.htm",
  "Grilled-figs.htm",
  "KonaLimeTequilaCheviche.htm",
  "JackfruitCurry.htm",
  "figwinevenison.htm",
  "grumipilaf.htm",
  // Collections / multi-recipe
  "recipet.htm",
  "jellyrecipes.htm",
];

// ── Text cleaning helpers ──────────────────────────────────────────────────

/**
 * Clean text extracted by cheerio: collapse whitespace, strip
 * Japanese fullwidth spaces (U+FF20 / \uFFFD artifacts), trim.
 */
function cleanText(raw) {
  return raw
    .replace(/[\uFF20\uFFFD\u00A0\uFEFF]/g, " ")  // full-width @ and other artifacts
    .replace(/\u3000/g, " ")                         // ideographic space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get all visible text paragraphs from a cheerio body, returning an array
 * of non-empty strings.
 */
function extractParas($, container) {
  const paras = [];
  $(container)
    .find("p, li, div.MsoNormal, div.ListParagraph")
    .each((_, el) => {
      const text = cleanText($(el).text());
      if (text && text !== "&nbsp;" && text.length > 0) {
        paras.push(text);
      }
    });
  return paras;
}

// ── Ingredient / method splitting heuristics ──────────────────────────────

const INGREDIENT_HEADERS = /^(ingredients?|ingredient list|what you need)\s*[:\-]?\s*$/i;
const METHOD_HEADERS = /^(procedure|directions?|method|instructions?|preparation|directions|steps?)\s*[:\-]?\s*$/i;
const SERVES_RE = /^(makes|serves|yield|serving)\b/i;

/**
 * Given an array of paragraph strings, split into ingredients[] and method string.
 * Strategy:
 *   1. Look for explicit "Ingredients:" and "Procedure:" / "Directions:" headers.
 *   2. If not found, heuristically split: short bullet-like lines → ingredients,
 *      longer prose → method.
 */
function splitIngredientsMethod(paras) {
  // Find explicit section headers
  let ingredientStart = -1;
  let methodStart = -1;

  for (let i = 0; i < paras.length; i++) {
    if (INGREDIENT_HEADERS.test(paras[i])) ingredientStart = i;
    if (METHOD_HEADERS.test(paras[i])) methodStart = i;
  }

  let ingredients = [];
  let method = "";
  let notes = "";

  if (ingredientStart >= 0 && methodStart > ingredientStart) {
    // Classic structure
    const ingLines = paras.slice(ingredientStart + 1, methodStart);
    const methLines = paras.slice(methodStart + 1);

    ingredients = ingLines
      .filter((l) => l.length > 0 && !SERVES_RE.test(l))
      .map(cleanText);
    method = methLines
      .filter((l) => l.length > 0)
      .join(" ");
  } else if (ingredientStart >= 0 && methodStart === -1) {
    // Only ingredients section found — rest is method
    const ingLines = paras.slice(ingredientStart + 1);
    // Split: short lines as ingredients, long lines as method
    ingredients = [];
    const methParts = [];
    for (const line of ingLines) {
      if (line.length < 80 && !/[.!?]$/.test(line)) {
        ingredients.push(line);
      } else {
        methParts.push(line);
      }
    }
    method = methParts.join(" ");
  } else if (methodStart >= 0 && ingredientStart === -1) {
    // Only method header — everything before is ingredients
    ingredients = paras
      .slice(0, methodStart)
      .filter((l) => l.length > 0 && !SERVES_RE.test(l));
    method = paras
      .slice(methodStart + 1)
      .filter((l) => l.length > 0)
      .join(" ");
  } else {
    // No explicit headers: heuristic split
    // Short lines (< 80 chars, no sentence-ending punctuation) → ingredients
    // Long prose → method
    const ingParts = [];
    const methParts = [];
    for (const line of paras) {
      if (line.length < 80 && !/[.!?]$/.test(line) && !/^\d+\./.test(line)) {
        ingParts.push(line);
      } else {
        methParts.push(line);
      }
    }
    // If more than half is "method" lines, they probably are method
    if (methParts.length > ingParts.length) {
      ingredients = ingParts;
      method = methParts.join(" ");
    } else {
      // All body text — put everything in method
      method = paras.join(" ");
    }
  }

  return {
    ingredients: ingredients.filter((i) => i.length > 0),
    method: cleanText(method),
  };
}

// ── Per-file parser ────────────────────────────────────────────────────────

/**
 * Parse a single recipe file. May return multiple records (e.g. jellyrecipes.htm).
 */
function parseRecipeFile(filePath, relPath) {
  let html;
  try {
    // Try UTF-8 first; if that fails, try latin1
    html = readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`  [ERROR] Cannot read ${relPath}: ${e.message}`);
    return [];
  }

  const $ = cheerio.load(html, { decodeEntities: true });

  // ── Extract title ────────────────────────────────────────────────────────
  // Priority: <meta name=Title>, then <title>, then first heading/bold text
  let title =
    $('meta[name="Title"]').attr("content") ||
    $('meta[name="title"]').attr("content") ||
    $("title").text() ||
    "";
  title = cleanText(title);

  // If title is empty or generic, try first bold/heading in body
  if (!title || title === "12 Trees Project Recipe Template") {
    const firstHeading = $("h1, h2, h3").first().text();
    if (firstHeading) title = cleanText(firstHeading);
  }
  if (!title) {
    // fallback: first non-empty paragraph text
    const firstPara = $("p").first().text();
    title = cleanText(firstPara).substring(0, 100);
  }

  // ── Extract images ───────────────────────────────────────────────────────
  const images = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.includes("image001") && !src.includes("image002")) {
      // Skip VML placeholder images; capture the real ones
      images.push(src);
    } else if (src) {
      images.push(src);
    }
  });

  // ── For jellyrecipes.htm and similar multi-recipe files, detect separator ─
  const bodyText = $("body").text();
  const separatorRe = /---+/;

  // Check if file is a multi-recipe collection by looking for "---" separators
  // or multiple recipe titles in the body
  const hasSeparators = separatorRe.test(bodyText);

  if (hasSeparators) {
    return parseMultiRecipeFile($, filePath, relPath, title);
  }

  // ── Single recipe ────────────────────────────────────────────────────────
  const paras = extractParas($, "body");
  const { ingredients, method } = splitIngredientsMethod(paras);

  const allText = [title, ...ingredients, method];
  const plant_ids = matchPlantIds(allText);

  const record = {
    title,
    ingredients,
    method,
    images: images.slice(0, 10), // cap image list
    plant_ids,
    source_file: relPath,
  };

  return [record];
}

/**
 * Parse multi-recipe files that contain "---" separator lines between recipes.
 */
function parseMultiRecipeFile($, filePath, relPath, pageTitle) {
  const records = [];

  // Collect all paragraphs in order
  const allParas = [];
  $("body p, body li").each((_, el) => {
    const text = cleanText($(el).text());
    if (text) allParas.push(text);
  });

  // Split on "---" separators
  const chunks = [];
  let current = [];
  for (const para of allParas) {
    if (/^---+$/.test(para)) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
    } else {
      current.push(para);
    }
  }
  if (current.length > 0) chunks.push(current);

  for (const chunk of chunks) {
    if (chunk.length === 0) continue;

    // First non-empty line is the recipe title
    const title = chunk[0];
    // Second non-empty line may be an author
    let author = "";
    let bodyStart = 1;
    if (chunk[1] && chunk[1].length < 60 && !/ingredients/i.test(chunk[1]) && !/^\d/.test(chunk[1])) {
      author = chunk[1];
      bodyStart = 2;
    }

    const paras = chunk.slice(bodyStart);
    const { ingredients, method } = splitIngredientsMethod(paras);

    const allText = [title, author, ...ingredients, method];
    const plant_ids = matchPlantIds(allText);

    records.push({
      title: cleanText(title),
      author: author || undefined,
      ingredients,
      method,
      plant_ids,
      source_file: relPath,
    });
  }

  // If no records could be split, return one record for the whole page
  if (records.length === 0) {
    const paras = allParas;
    const { ingredients, method } = splitIngredientsMethod(paras);
    const plant_ids = matchPlantIds([pageTitle, ...ingredients, method]);
    records.push({ title: pageTitle, ingredients, method, plant_ids, source_file: relPath });
  }

  return records;
}

// ── Main ───────────────────────────────────────────────────────────────────

const allRecipes = [];
let filesProcessed = 0;
let filesMissing = 0;
let filesErrored = 0;

for (const filename of RECIPE_FILES) {
  const filePath = join(SOURCE, filename);
  const relPath = `HawaiiFruit. Net/${filename}`;

  if (!existsSync(filePath)) {
    console.warn(`  [MISSING] ${filename}`);
    filesMissing++;
    continue;
  }

  console.log(`  Parsing: ${filename}`);
  try {
    const records = parseRecipeFile(filePath, relPath);
    if (records.length === 1) {
      console.log(`    -> title: "${records[0].title}" | ingredients: ${records[0].ingredients.length} | plants: ${records[0].plant_ids.join(", ") || "none"}`);
    } else {
      console.log(`    -> ${records.length} sub-recipes extracted`);
      for (const r of records) {
        console.log(`       * "${r.title}" | plants: ${r.plant_ids.join(", ") || "none"}`);
      }
    }
    allRecipes.push(...records);
    filesProcessed++;
  } catch (e) {
    console.error(`  [ERROR] ${filename}: ${e.message}`);
    filesErrored++;
  }
}

// ── Write output ───────────────────────────────────────────────────────────
const output = {
  generated: new Date().toISOString(),
  description: "Phase 3 Recipe extraction from HawaiiFruit.Net root .htm files",
  source_directory: "content/source/HawaiiFruit. Net/",
  files_processed: filesProcessed,
  files_missing: filesMissing,
  files_errored: filesErrored,
  recipe_count: allRecipes.length,
  recipes: allRecipes,
};

const outPath = join(PARSED, "phase3_recipes.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log("\n=== Recipe Extraction Complete ===");
console.log(`  Files processed : ${filesProcessed}`);
console.log(`  Files missing   : ${filesMissing}`);
console.log(`  Files errored   : ${filesErrored}`);
console.log(`  Recipes output  : ${allRecipes.length}`);
console.log(`  Written to      : ${outPath}`);
