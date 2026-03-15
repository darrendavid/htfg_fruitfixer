/**
 * parse_jcitruslist.mjs
 *
 * Parses content/source/HawaiiFruit. Net/Jcitruslist.htm
 * and writes structured JSON to content/parsed/phase1_japanese_citrus.json
 *
 * The file is Word-generated HTML (HTML 4.01 Transitional).
 * Each entry is a <p class=MsoNormal> paragraph.
 * There are no surrounding list or table elements.
 *
 * Entry formats observed:
 *   1. "Citrus unshiu Marcovitch    Satsuma mandarin"
 *      -> botanical_name + variety_name (common name)
 *
 *   2. "Citrus reticulata Blanco – Var:  Chinese honey"
 *      -> botanical_name + "Var:" prefix + variety_name
 *
 *   3. "Citrus kinokuni Hort.ex Tanaka Var: Mukakisyu"
 *      -> botanical_name + "Var:" + variety_name
 *
 *   4. "Citrus kinokuni Hort.ex Tanaka  (Kishu mikan)"
 *      -> botanical_name + parenthetical common name
 *
 *   5. Misc tangerine section (no botanical name): plain variety names
 *      "Lee mandarin", "Amaka", "Fairchild tangerine tangelo", etc.
 *
 *   6. Notes / parenthetical lines: "(+mihokoru + harumi)", "(Misc. tangerines...)"
 *      -> skip as metadata, but capture as notes where useful
 *
 * Parent species grouping:
 *   When a new botanical species appears (no "Var:" suffix),
 *   it establishes the current parent_species for subsequent "Var:" entries
 *   that share the same species epithet.
 *
 * Strategy (no cheerio needed — plain text extraction is sufficient):
 *   1. Strip all HTML tags to get plain text lines.
 *   2. Normalise whitespace (tabs, &nbsp;, multiple spaces -> single space).
 *   3. Classify each non-empty line and build records.
 */

import fs   from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SOURCE_FILE = path.resolve(
  "d:/Sandbox/Homegrown/htfg_fruit/content/source/HawaiiFruit. Net/Jcitruslist.htm"
);
const OUT_DIR  = path.resolve("d:/Sandbox/Homegrown/htfg_fruit/content/parsed");
const OUT_FILE = path.join(OUT_DIR, "phase1_japanese_citrus.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode a small set of entities. */
function stripHtml(raw) {
  return raw
    .replace(/<[^>]*>/g, ' ')       // remove all tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8211;/g, '–')       // en-dash
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00a0/g, ' ');       // non-breaking space (char)
}

/** Collapse runs of whitespace (incl. tabs) to a single space and trim. */
function normalise(text) {
  return text.replace(/[\s\t]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Extract paragraph text strings from the HTML
// ---------------------------------------------------------------------------

const rawHtml = fs.readFileSync(SOURCE_FILE, 'utf8');

// Split on paragraph tags to get one potential entry per paragraph
const paraMatches = rawHtml.match(/<p[^>]*class=MsoNormal[^>]*>([\s\S]*?)<\/p>/gi) || [];

const lines = paraMatches
  .map(p => normalise(stripHtml(p)))
  .filter(l => l && l !== '\u00a0' && l.length > 0);

// ---------------------------------------------------------------------------
// Classify lines and build variety records
// ---------------------------------------------------------------------------

/**
 * Recognised patterns:
 *
 *  A) Line starts with a known genus (Citrus, Fortunella, Poncirus)
 *     -> has a botanical name component
 *
 *  B) Otherwise -> misc/unnamed variety (no botanical name)
 *
 * For lines with a botanical name:
 *   - Split on "Var:" (case-insensitive) to separate species from variety.
 *   - Split on common-name separators (tabs, 2+ spaces, " – ", " - ")
 *     AFTER the botanical authority string.
 *
 * Botanical name = genus + species epithet + authority
 * Authority ends at a " – ", " - ", "  " (two spaces), "Var:", or "(":
 */

const GENUS_RE = /^(Citrus|Fortunella|Poncirus)\b/i;

// Lines that are clearly section headers or notes to skip or store separately
const SKIP_RE = /^\(.*\)$|^Ken$|^This is a list/i;

// Separator between botanical name and common/variety name:
//   "–" or "-" (en/em dash), or 2+ spaces, or a tab
const NAME_SEP_RE = /\s*[–\-]{1,2}\s*(?:Var:\s*)?|\s{2,}|\t/;

// Explicit "Var:" marker
const VAR_RE = /\s+[Vv]ar:\s*/;

const varieties = [];
let   currentParentSpecies = '';
let   currentParentBotanical = '';

// Preamble lines to skip (intro text before the first citrus entry)
const PREAMBLE_STOP = 'Citrus unshiu'; // first real entry marker
let   preambleDone  = false;

// Section heading for misc tangerines
let   inMiscSection = false;
const MISC_SECTION_RE = /Misc\.\s*tangerines?\s*\/\s*Manderines/i;

for (const line of lines) {

  // Skip known noise
  if (SKIP_RE.test(line)) continue;

  // Skip preamble lines until we reach the first citrus entry
  if (!preambleDone) {
    if (line.includes(PREAMBLE_STOP)) {
      preambleDone = true;
    } else {
      continue;
    }
  }

  // Detect misc/unnamed tangerine section marker
  if (MISC_SECTION_RE.test(line)) {
    inMiscSection = true;
    currentParentSpecies  = 'Misc. tangerines / Mandarines';
    currentParentBotanical = '';
    continue;
  }

  // -----------------------------------------------------------------------
  // Lines with a known genus
  // -----------------------------------------------------------------------
  if (GENUS_RE.test(line)) {
    inMiscSection = false; // reset when we return to formal entries

    // Does this line contain an explicit "Var:" marker?
    if (VAR_RE.test(line)) {
      // e.g. "Citrus reticulata Blanco – Var:  Chinese honey"
      //   or "Citrus kinokuni Hort.ex Tanaka Var: Mukakisyu"
      const varIdx = line.search(VAR_RE);
      const botanicalPart = line.slice(0, varIdx).trim();
      const varPart       = line.slice(varIdx).replace(/^\s*[Vv]ar:\s*/, '').trim();

      // Derive parent species from the botanical part
      // (genus + species epithet = first two tokens, ignoring authority)
      const tokens = botanicalPart.split(/\s+/);
      const parentBotanical = tokens.slice(0, 2).join(' ');  // e.g. "Citrus kinokuni"

      // Only update parent when the species changes
      if (parentBotanical !== currentParentBotanical) {
        currentParentBotanical = parentBotanical;
        currentParentSpecies   = parentBotanical;
      }

      varieties.push({
        variety_name:     varPart,
        botanical_name:   botanicalPart,
        description:      '',
        parent_species:   currentParentSpecies,
      });

    } else {
      // No explicit Var: — the entire line may be:
      //   "Citrus unshiu Marcovitch    Satsuma mandarin"
      //   "Citrus depressa Hayata – Shikuwasha (very popular)"
      //   "Citrus tachibana Tanaka"         (no common name)
      //   "Citrus ichangenensis Swingle"
      //   "Fortunella crassifolix Swingle – Ninpou kumquat"

      // Split on the first strong separator to find common name
      // Strong separators: " – ", " - ", parenthetical "(", or 2+ spaces
      const sepMatch = line.match(/\s+[–\-]\s+|\s{2,}|\t/);

      let botanicalPart = line;
      let commonName    = '';
      let description   = '';

      if (sepMatch) {
        const sepIdx = line.indexOf(sepMatch[0]);
        botanicalPart = line.slice(0, sepIdx).trim();
        const rest    = line.slice(sepIdx + sepMatch[0].length).trim();

        // Parenthetical note like "(very popular)" appended to common name
        const parenMatch = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (parenMatch) {
          commonName  = parenMatch[1].trim();
          description = parenMatch[2].trim();
        } else {
          commonName = rest;
        }
      } else {
        // Possibly a parenthetical common name inline: "Citrus kinokuni Hort.ex Tanaka  (Kishu mikan)"
        const parenInline = botanicalPart.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (parenInline) {
          botanicalPart = parenInline[1].trim();
          commonName    = parenInline[2];
        }
      }

      // Derive parent species (genus + epithet) from botanicalPart
      const tokens = botanicalPart.split(/\s+/);
      const parentBotanical = tokens.slice(0, 2).join(' ');

      currentParentBotanical = parentBotanical;
      currentParentSpecies   = parentBotanical;

      varieties.push({
        variety_name:   commonName || botanicalPart,  // fall back to full name if no common
        botanical_name: botanicalPart,
        description:    description,
        parent_species: '',   // top-level species entry has no parent
      });
    }

  // -----------------------------------------------------------------------
  // Plain name lines (misc tangerine section or standalone names)
  // -----------------------------------------------------------------------
  } else {
    // Skip if it looks like a note (starts/ends with parentheses but isn't a variety)
    if (/^\(.*\)$/.test(line)) continue;

    // Handle "Fairchild tangerine tangelo" appearing BEFORE the misc section marker
    // and other standalone names

    // Some lines have a note in parentheses: strip it as description
    const parenMatch = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    let varietyName = line;
    let desc        = '';
    if (parenMatch) {
      varietyName = parenMatch[1].trim();
      desc        = parenMatch[2].trim();
    }

    if (!varietyName) continue;

    varieties.push({
      variety_name:   varietyName,
      botanical_name: '',
      description:    desc,
      parent_species: currentParentSpecies || 'Misc. tangerines / Mandarines',
    });
  }
}

// ---------------------------------------------------------------------------
// Clean up: remove any empty variety_name entries
// ---------------------------------------------------------------------------
const cleaned = varieties.filter(v => v.variety_name && v.variety_name.trim());

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

const output = {
  source_file:    "content/source/HawaiiFruit. Net/Jcitruslist.htm",
  extracted_date: new Date().toISOString().slice(0, 10),
  notes: [
    "Source: Word 11 HTML export, original data compiled by Ken Love from a 2006 book by Hiroshi Hatano (formerly Miyazaki Japan Ag dept and Univ.).",
    "Some entries lack Latin names; they are presented as-is from the source.",
    "parent_species is empty for top-level species entries (no parent above them).",
    "Duplicate Fortunella crassifolix Swingle / Ninpou kumquat entries are preserved as they appear in the source."
  ],
  variety_count:  cleaned.length,
  varieties:      cleaned,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

console.log(`Wrote ${cleaned.length} varieties to: ${OUT_FILE}`);

// Print a quick summary table for verification
console.log('\nFirst 10 records:');
cleaned.slice(0, 10).forEach((v, i) => {
  console.log(`  [${i+1}] variety_name="${v.variety_name}" | botanical="${v.botanical_name}" | parent="${v.parent_species}"`);
});
console.log('\nLast 10 records:');
cleaned.slice(-10).forEach((v, i) => {
  console.log(`  [${cleaned.length - 9 + i}] variety_name="${v.variety_name}" | botanical="${v.botanical_name}" | parent="${v.parent_species}"`);
});
