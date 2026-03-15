/**
 * Phase 3: Extract Structured Data from Excel Spreadsheets
 *
 * Target files:
 *   1. content/source/original/Bananaspapaya/Hawaiian Banana Varieties.xls
 *   2. content/source/HawaiiFruit. Net/figtastescale.xls
 *   3. content/source/original/fruit pix/avocados/VarietyDatabase03.xls
 *   4. content/source/original/fruit pix/avocados/Varietyname.xls
 *   5–8. Copies of 3–4 in avos-assorted/ and avos-assorted 2/ (deduplicated by size+mtime)
 *
 * Outputs: content/parsed/phase3_spreadsheets.json
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "content", "source");
const PARSED = join(ROOT, "content", "parsed");

mkdirSync(PARSED, { recursive: true });

// ── Plant registry for cross-referencing ─────────────────────────────────────
const registryPath = join(PARSED, "plant_registry.json");
let plantRegistry = { plants: [] };
try {
  plantRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
  console.log(`Loaded plant registry: ${plantRegistry.plant_count} plants`);
} catch (e) {
  console.warn("Could not load plant_registry.json:", e.message);
}

/** Build a quick lookup map: normalised common name -> plant id */
function buildPlantLookup(registry) {
  const map = new Map();
  for (const plant of registry.plants || []) {
    const add = (key) => {
      if (key) map.set(key.toLowerCase().trim(), plant.id);
    };
    add(plant.common_name);
    for (const alias of plant.aliases || []) add(alias);
    for (const bot of plant.botanical_names || []) add(bot);
  }
  return map;
}

const plantLookup = buildPlantLookup(plantRegistry);

/** Try to find a plant_id for a given name string */
function lookupPlantId(name) {
  if (!name) return null;
  return plantLookup.get(String(name).toLowerCase().trim()) ?? null;
}

// ── File manifest with deduplication metadata ─────────────────────────────────
const TARGET_FILES = [
  {
    rel_path: "original/Bananaspapaya/Hawaiian Banana Varieties.xls",
    abs_path: join(SOURCE, "original", "Bananaspapaya", "Hawaiian Banana Varieties.xls"),
    label: "banana-varieties",
    hint_plant: "banana",
  },
  {
    rel_path: "HawaiiFruit. Net/figtastescale.xls",
    abs_path: join(SOURCE, "HawaiiFruit. Net", "figtastescale.xls"),
    label: "fig-taste-scale",
    hint_plant: "fig",
  },
  {
    rel_path: "original/fruit pix/avocados/VarietyDatabase03.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avocados", "VarietyDatabase03.xls"),
    label: "avocado-variety-db",
    hint_plant: "avocado",
  },
  {
    rel_path: "original/fruit pix/avocados/Varietyname.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avocados", "Varietyname.xls"),
    label: "avocado-variety-names",
    hint_plant: "avocado",
  },
  // Potential duplicates
  {
    rel_path: "original/fruit pix/avos-assorted/VarietyDatabase03.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avos-assorted", "VarietyDatabase03.xls"),
    label: "avocado-variety-db",
    hint_plant: "avocado",
  },
  {
    rel_path: "original/fruit pix/avos-assorted/Varietyname.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avos-assorted", "Varietyname.xls"),
    label: "avocado-variety-names",
    hint_plant: "avocado",
  },
  {
    rel_path: "original/fruit pix/avos-assorted/avos-assorted 2/VarietyDatabase03.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avos-assorted", "avos-assorted 2", "VarietyDatabase03.xls"),
    label: "avocado-variety-db",
    hint_plant: "avocado",
  },
  {
    rel_path: "original/fruit pix/avos-assorted/avos-assorted 2/Varietyname.xls",
    abs_path: join(SOURCE, "original", "fruit pix", "avos-assorted", "avos-assorted 2", "Varietyname.xls"),
    label: "avocado-variety-names",
    hint_plant: "avocado",
  },
];

// ── Gather file stats for deduplication ──────────────────────────────────────
function getFileStats(absPath) {
  try {
    const s = statSync(absPath);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

// Build a signature map: "size:mtime" -> first rel_path that had this signature
const seenSignatures = new Map();

for (const f of TARGET_FILES) {
  const stats = getFileStats(f.abs_path);
  if (!stats) {
    f.exists = false;
    f.is_duplicate = false;
    continue;
  }
  f.exists = true;
  f.size = stats.size;
  f.mtime = stats.mtime;
  const sig = `${stats.size}:${stats.mtime}`;
  if (seenSignatures.has(sig)) {
    f.is_duplicate = true;
    f.duplicate_of = seenSignatures.get(sig);
    console.log(`  [DUPLICATE] ${f.rel_path}  =>  ${f.duplicate_of}`);
  } else {
    f.is_duplicate = false;
    f.duplicate_of = null;
    seenSignatures.set(sig, f.rel_path);
  }
}

// ── Sheet extraction helpers ──────────────────────────────────────────────────

/** Convert a SheetJS sheet to an array of row objects keyed by header */
function sheetToRows(sheet, sheetName) {
  // Use header:1 to get raw arrays, then we normalise headers ourselves
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (rawRows.length === 0) {
    return { headers: [], rows: [], notes: ["empty sheet"] };
  }

  // Find the first non-empty row as the header row.
  // Some sheets have a title in row 0 and headers in row 1.
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rawRows.length); i++) {
    const nonNull = rawRows[i].filter((c) => c !== null && c !== "");
    if (nonNull.length >= 2) {
      headerRowIdx = i;
      break;
    }
  }

  const rawHeaders = rawRows[headerRowIdx];

  // Normalise header names: trim, replace nulls with positional fallback
  const headers = rawHeaders.map((h, idx) =>
    h !== null && h !== "" ? String(h).trim() : `col_${idx}`
  );

  const notes = [];
  if (headerRowIdx > 0) {
    notes.push(`header row found at index ${headerRowIdx} (skipped ${headerRowIdx} title rows)`);
  }

  // Check for duplicate header names (common in old XLS files)
  const headerCounts = {};
  for (const h of headers) {
    headerCounts[h] = (headerCounts[h] || 0) + 1;
  }
  const dedupedHeaders = headers.map((h, idx) => {
    if (headerCounts[h] > 1) {
      headerCounts[h + "_seen"] = (headerCounts[h + "_seen"] || 0) + 1;
      return `${h}_${headerCounts[h + "_seen"]}`;
    }
    return h;
  });

  // Build row objects from data rows (after the header row)
  const rows = [];
  let emptyRowsSkipped = 0;
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const obj = {};
    let hasValue = false;
    for (let c = 0; c < dedupedHeaders.length; c++) {
      const val = raw[c] !== undefined ? raw[c] : null;
      obj[dedupedHeaders[c]] = val;
      if (val !== null && val !== "") hasValue = true;
    }
    // Capture any overflow columns beyond known headers
    if (raw.length > dedupedHeaders.length) {
      for (let c = dedupedHeaders.length; c < raw.length; c++) {
        if (raw[c] !== null && raw[c] !== "") {
          obj[`extra_col_${c}`] = raw[c];
          hasValue = true;
        }
      }
    }
    if (hasValue) {
      rows.push(obj);
    } else {
      emptyRowsSkipped++;
    }
  }

  if (emptyRowsSkipped > 0) {
    notes.push(`${emptyRowsSkipped} fully-empty rows skipped`);
  }

  return { headers: dedupedHeaders, rows, notes };
}

/** Assess extraction quality */
function assessQuality(sheets) {
  if (sheets.length === 0) return "needs_review";
  const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0);
  if (totalRows === 0) return "needs_review";
  const hasNotes = sheets.some((sh) => sh.notes && sh.notes.length > 0);
  if (totalRows < 3 || hasNotes) return "partial";
  return "clean";
}

/** Infer plant_id from a sheet — checks header names and hint */
function inferPlantId(headers, hintPlant) {
  // Try to match hint plant directly
  if (hintPlant) {
    const directMatch = lookupPlantId(hintPlant);
    if (directMatch) return directMatch;
  }
  // Try to find a plant name mentioned in any header
  for (const h of headers) {
    const match = lookupPlantId(h);
    if (match) return match;
  }
  return null;
}

// ── Main extraction loop ──────────────────────────────────────────────────────

const results = [];

for (const f of TARGET_FILES) {
  if (!f.exists) {
    console.log(`[MISSING] ${f.rel_path}`);
    results.push({
      source_file: f.rel_path,
      sheets: [],
      quality: "needs_review",
      error: "file not found",
      duplicates: [],
    });
    continue;
  }

  if (f.is_duplicate) {
    console.log(`[SKIP DUP] ${f.rel_path}  (same as ${f.duplicate_of})`);
    // Still record the duplicate in the canonical file's record below
    continue;
  }

  console.log(`\n[PROCESSING] ${f.rel_path}  (${(f.size / 1024).toFixed(1)} KB)`);

  let workbook;
  const parseErrors = [];
  try {
    workbook = XLSX.readFile(f.abs_path, {
      type: "file",
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellDates: true,
      // dense: false gives us a standard sheet object
    });
  } catch (err) {
    console.error(`  ERROR reading ${f.rel_path}:`, err.message);
    results.push({
      source_file: f.rel_path,
      file_size_bytes: f.size,
      sheets: [],
      quality: "needs_review",
      error: err.message,
      duplicates: [],
    });
    continue;
  }

  const sheetResults = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet["!ref"];
    console.log(`  Sheet "${sheetName}"  range=${range || "empty"}`);

    if (!range) {
      sheetResults.push({
        name: sheetName,
        headers: [],
        rows: [],
        plant_id: null,
        notes: ["sheet has no data range"],
      });
      continue;
    }

    let extracted;
    try {
      extracted = sheetToRows(sheet, sheetName);
    } catch (err) {
      console.error(`    ERROR extracting rows from sheet "${sheetName}":`, err.message);
      sheetResults.push({
        name: sheetName,
        headers: [],
        rows: [],
        plant_id: null,
        notes: [`extraction error: ${err.message}`],
      });
      parseErrors.push(`sheet "${sheetName}": ${err.message}`);
      continue;
    }

    console.log(`    ${extracted.headers.length} columns, ${extracted.rows.length} data rows`);
    if (extracted.notes.length > 0) {
      console.log(`    Notes: ${extracted.notes.join("; ")}`);
    }

    const plantId = inferPlantId(extracted.headers, f.hint_plant);

    sheetResults.push({
      name: sheetName,
      headers: extracted.headers,
      rows: extracted.rows,
      row_count: extracted.rows.length,
      plant_id: plantId,
      notes: extracted.notes,
    });
  }

  // Collect which files are duplicates of this one
  const duplicateOf = TARGET_FILES
    .filter((d) => d.is_duplicate && d.duplicate_of === f.rel_path)
    .map((d) => d.rel_path);

  const quality = parseErrors.length > 0 ? "needs_review" : assessQuality(sheetResults);

  results.push({
    source_file: f.rel_path,
    file_size_bytes: f.size,
    sheets: sheetResults,
    quality,
    parse_errors: parseErrors.length > 0 ? parseErrors : undefined,
    duplicates: duplicateOf,
  });

  if (duplicateOf.length > 0) {
    console.log(`  Confirmed duplicates: ${duplicateOf.join(", ")}`);
  }
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  generated: new Date().toISOString(),
  description: "Phase 3 spreadsheet extraction — Excel files from HawaiiFruit.net archive",
  source_root: "content/source/",
  file_count_processed: results.filter((r) => !r.error || r.error !== "file not found").length,
  files: results,
};

const outPath = join(PARSED, "phase3_spreadsheets.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log(`\nDone. Output written to: ${outPath}`);
console.log(`Files processed: ${output.file_count_processed}`);
const totalRows = results.flatMap((f) => f.sheets).reduce((s, sh) => s + (sh.row_count || 0), 0);
console.log(`Total data rows extracted: ${totalRows}`);

// Summary table
console.log("\nSummary:");
for (const f of results) {
  const rowTotals = f.sheets.reduce((s, sh) => s + (sh.row_count || 0), 0);
  console.log(
    `  [${f.quality?.toUpperCase() ?? "N/A"}]  ${f.source_file}` +
    (f.duplicates?.length ? `  (${f.duplicates.length} duplicate(s))` : "") +
    (rowTotals > 0 ? `  => ${rowTotals} rows` : "") +
    (f.error ? `  ERROR: ${f.error}` : "")
  );
}
