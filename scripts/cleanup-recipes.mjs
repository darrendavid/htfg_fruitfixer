/**
 * cleanup-recipes.mjs — Clean up Phase 3 recipe data
 *
 * Fixes bad titles, splits mixed ingredients/method, re-resolves plant_ids
 * through the alias map, and normalises whitespace/padding.
 *
 * Input:  content/parsed/phase3_recipes.json
 *         content/parsed/cleanup_alias_map.json
 * Output: content/parsed/cleanup_recipes.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseDir = path.join(import.meta.dirname, '..', 'content', 'parsed');

// ── Load inputs ──────────────────────────────────────────────────────────────

console.log('Loading input files...');
const recipesData = JSON.parse(readFileSync(path.join(baseDir, 'phase3_recipes.json'), 'utf-8'));
const aliasData = JSON.parse(readFileSync(path.join(baseDir, 'cleanup_alias_map.json'), 'utf-8'));

const recipes = recipesData.recipes;
const aliases = aliasData.aliases; // { "lime": { canonical_id, type, source }, ... }

console.log(`Loaded ${recipes.length} recipes, ${Object.keys(aliases).length} aliases`);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Set of all canonical plant IDs reachable through the alias map */
const canonicalIds = new Set(Object.values(aliases).map(a => a.canonical_id));

/** Build a lookup list: sorted longest-first so greedy matching works */
const aliasKeys = Object.keys(aliases).sort((a, b) => b.length - a.length);

// Patterns that indicate an email-header title
const BAD_TITLE_PATTERNS = [
  /^Date:/i,
  /^-+\s*Original Message/i,
  /^From:/i,
  /^Subject:/i,
  /^>\s*Aloha\b/i,
  /^Aloha\s+\w+,$/i,
  /^Aloha\s+\w+,$|^Aloha\s+\w+,\s*$/i,
  /^PS:$/i,
  /^My recipe$/i,
  /^Recipe Name$/i,
  /^6 quarts water$/i,       // clearly not a title
  /^JAR WONTONS:$/i,         // partial title from mid-recipe
];

// Measurement patterns used to detect ingredient lines
const MEASUREMENT_RE = /\d+\.?\d*\s*(cups?|oz\.?|fl\s*oz|tsp\.?|tbsp?\.?|[Tt]ablespoons?|teaspoons?|pounds?|lbs?\.?|#|quarts?|gallons?|pints?|grams?|cups|T\b|tbl\.?|tbs\.?|pkg|pc|ea\b|liter|litre)/i;

// Verb starters for method lines
const METHOD_VERB_RE = /^(combine|mix|stir|add|heat|bring|cook|reduce|strain|pour|serve|whisk|blend|bake|preheat|remove|let|cool|put|place|cut|drain|fold|beat|simmer|boil|chop|dice|peel|seed|juice|melt|cover|turn|stop|whip|pipe|fill|cap|squeeze|measure|check|use|don't)/i;

/**
 * Derive a title from a source filename.
 * e.g. "HawaiiFruit. Net/KonaLimeSauce.htm" → "Kona Lime Sauce"
 */
function titleFromFilename(sourceFile) {
  const basename = path.basename(sourceFile, path.extname(sourceFile));
  // Split on camelCase boundaries, hyphens, underscores
  const parts = basename
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // consecutive caps
    .replace(/[-_]+/g, ' ')                  // hyphens/underscores
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  // Capitalize each word
  return parts
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Normalise text: trim, remove @ padding, collapse multiple spaces.
 */
function normalise(text) {
  if (!text) return '';
  return text
    .replace(/@/g, ' ')
    .replace(/~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a title looks bad (email header, generic placeholder, etc.)
 */
function isBadTitle(title) {
  const t = title.trim();
  return BAD_TITLE_PATTERNS.some(re => re.test(t));
}

/**
 * Attempt to split a method string that contains both ingredients and
 * instructions into separate arrays.
 *
 * Returns { ingredients, method, confident } or null if no split was viable.
 */
function splitMethodIntoIngredients(methodText) {
  // Normalise first
  const text = normalise(methodText);

  // Split on common sentence/line boundaries
  // Many recipes use patterns like "3 cups sugar 1 cup water Combine..."
  // We try to find the transition point from ingredient-like to method-like lines.

  // Strategy: tokenise into "segments" separated by measurement quantities or
  // sentence boundaries, then classify each segment.

  // First, try splitting on sentence-like boundaries
  const segments = text
    .split(/(?<=\.)\s+|(?<=\d)\s+(?=[A-Z])|(?<=\w)\s+(?=\d+\s*(?:cups?|oz|tsp|tbsp|lbs?|#|T\b|quarts?|gallons?|grams?))/i)
    .filter(s => s.trim());

  if (segments.length < 2) return null;

  // More sophisticated: scan word-by-word and find ingredient chunks
  // An ingredient chunk typically starts with a number and contains a measurement
  const ingredientLines = [];
  const methodLines = [];
  let inMethod = false;

  // Re-split more carefully: look for "number + measurement + ingredient_name" patterns
  // then everything after the first method-like sentence goes to method
  const chunks = splitIntoChunks(text);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    if (inMethod) {
      methodLines.push(trimmed);
      continue;
    }

    // Is this an ingredient line?
    if (MEASUREMENT_RE.test(trimmed) && !METHOD_VERB_RE.test(trimmed)) {
      ingredientLines.push(trimmed);
    } else if (METHOD_VERB_RE.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      // Transition to method
      inMethod = true;
      methodLines.push(trimmed);
    } else if (ingredientLines.length === 0) {
      // Preamble (author name, etc.) — skip or keep as first ingredient context
      // If it looks like an author line, skip
      if (/^(By |Chef |Instructor )/i.test(trimmed) || trimmed.split(' ').length <= 3) {
        continue; // skip author/preamble
      }
      ingredientLines.push(trimmed);
    } else {
      // Ambiguous — could be ingredient continuation or start of method
      if (trimmed.length > 80) {
        // Long text is probably method
        inMethod = true;
        methodLines.push(trimmed);
      } else {
        ingredientLines.push(trimmed);
      }
    }
  }

  if (ingredientLines.length === 0 || methodLines.length === 0) {
    return null;
  }

  const confident = ingredientLines.length >= 2 && methodLines.length >= 1;

  return {
    ingredients: ingredientLines,
    method: methodLines.join(' '),
    confident
  };
}

/**
 * Split a run-on text into logical chunks by finding boundaries where
 * a new ingredient measurement begins, or a method verb starts.
 */
function splitIntoChunks(text) {
  // Simple approach: split on newlines, then on sentence boundaries
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 1) return lines;

  // If no newlines, try splitting on ". " followed by a digit (new ingredient)
  const chunks = [];
  const parts = text.split(/(?<=\.)\s+(?=\d)/);
  if (parts.length > 1) return parts;

  // Last resort: return as single chunk
  return [text];
}

/**
 * Resolve plant IDs through the alias map.
 * Returns a deduplicated sorted array of canonical IDs.
 */
function resolvePlantIds(existingIds, title, ingredientsText) {
  const resolved = new Set();

  // 1. Verify/map existing IDs
  for (const pid of existingIds) {
    const lower = pid.toLowerCase();
    if (canonicalIds.has(pid)) {
      resolved.add(pid);
    } else if (aliases[lower]) {
      resolved.add(aliases[lower].canonical_id);
    } else {
      // Try the ID as-is — might still be valid
      resolved.add(pid);
    }
  }

  // 2. Scan title + ingredients for additional plant name matches
  const searchText = [title, ingredientsText].join(' ').toLowerCase();

  for (const key of aliasKeys) {
    // Only match multi-character names (skip very short ones that cause false positives)
    if (key.length < 3) continue;

    // Word-boundary match
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(searchText)) {
      resolved.add(aliases[key].canonical_id);
    }
  }

  return [...resolved].sort();
}

// ── Main processing ──────────────────────────────────────────────────────────

const stats = {
  total: recipes.length,
  titles_fixed: 0,
  ingredients_split: 0,
  plant_ids_updated: 0,
  needs_review: 0
};

const cleanedRecipes = recipes.map((recipe, idx) => {
  const id = idx + 1;
  console.log(`[${id}/${recipes.length}] Processing: ${recipe.title.slice(0, 50)}...`);

  let title = normalise(recipe.title);
  let titleOriginal = null;
  let titleWasFixed = false;

  // Step 1: Fix bad titles
  if (isBadTitle(title)) {
    titleOriginal = recipe.title;
    title = titleFromFilename(recipe.source_file);
    titleWasFixed = true;
    stats.titles_fixed++;
    console.log(`  → Title fixed: "${title}"`);
  }

  // Normalise ingredients and method
  let ingredients = (recipe.ingredients || []).map(normalise).filter(Boolean);
  let method = normalise(recipe.method || '');

  // Step 2: If ingredients are empty and method contains measurements, try splitting
  let needsReview = false;
  let reviewReason = null;

  if (ingredients.length === 0 && MEASUREMENT_RE.test(method)) {
    const split = splitMethodIntoIngredients(method);
    if (split) {
      ingredients = split.ingredients;
      method = split.method;
      stats.ingredients_split++;
      console.log(`  → Split method: ${ingredients.length} ingredients extracted`);

      if (!split.confident) {
        needsReview = true;
        reviewReason = 'Ingredient/method split was uncertain';
        stats.needs_review++;
      }
    } else {
      // Could not split — flag for review
      needsReview = true;
      reviewReason = 'Method contains measurements but could not be split into ingredients';
      stats.needs_review++;
    }
  }

  // Step 3: Re-resolve plant_ids through alias map
  const ingredientsText = ingredients.join(' ');
  const oldPlantIds = recipe.plant_ids || [];
  const newPlantIds = resolvePlantIds(oldPlantIds, title, ingredientsText + ' ' + method);

  if (
    newPlantIds.length !== oldPlantIds.length ||
    !newPlantIds.every((p, i) => p === [...oldPlantIds].sort()[i])
  ) {
    stats.plant_ids_updated++;
    console.log(`  → Plant IDs updated: [${oldPlantIds.join(', ')}] → [${newPlantIds.join(', ')}]`);
  }

  return {
    id,
    title,
    ...(titleOriginal != null ? { title_original: titleOriginal } : {}),
    title_was_fixed: titleWasFixed,
    ingredients,
    method,
    plant_ids: newPlantIds,
    ...(recipe.images && recipe.images.length > 0 ? { images: recipe.images } : {}),
    source_file: recipe.source_file,
    needs_review: needsReview,
    review_reason: reviewReason
  };
});

// ── Write output ─────────────────────────────────────────────────────────────

const output = {
  generated: new Date().toISOString(),
  stats,
  recipes: cleanedRecipes
};

const outPath = path.join(baseDir, 'cleanup_recipes.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

console.log('\n=== Done ===');
console.log(`Total recipes:       ${stats.total}`);
console.log(`Titles fixed:        ${stats.titles_fixed}`);
console.log(`Ingredients split:   ${stats.ingredients_split}`);
console.log(`Plant IDs updated:   ${stats.plant_ids_updated}`);
console.log(`Needs review:        ${stats.needs_review}`);
console.log(`Output: ${outPath}`);
