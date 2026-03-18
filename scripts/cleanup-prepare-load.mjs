/**
 * cleanup-prepare-load.mjs
 *
 * Transforms cleaned data into per-table JSON files ready for
 * batch insertion into NocoDB. Each output is a flat JSON array
 * of row objects with Title_Case column names.
 *
 * Usage: node scripts/cleanup-prepare-load.mjs
 */

import fs from "fs";
import path from "path";

const PARSED_DIR = path.join(import.meta.dirname, "..", "content", "parsed");

function readJson(filename) {
  const fp = path.join(PARSED_DIR, filename);
  console.log(`  Reading ${filename}...`);
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

function writeJson(filename, data) {
  const fp = path.join(PARSED_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  Wrote ${filename} — ${data.length} records`);
}

// ---------------------------------------------------------------------------
// 1. Plants
// ---------------------------------------------------------------------------
console.log("\n[1/6] Plants");
const { plants } = readJson("cleanup_plants_canonical.json");
const loadPlants = plants.map((p) => ({
  Id: p.id,
  Canonical_Name: p.canonical_name,
  Botanical_Name: Array.isArray(p.botanical_name) ? p.botanical_name[0] : p.botanical_name,
  Family: p.family,
  Category: p.category,
  Aliases: JSON.stringify(p.aliases),
  Description: p.description,
  Harvest_Months: JSON.stringify(p.harvest_months),
  Tasting_Notes: null,
  At_Kona_Station: p.at_kona_station,
  Source_Count: p.source_count,
  Image_Count: p.image_count,
}));
writeJson("load_plants.json", loadPlants);

// ---------------------------------------------------------------------------
// 2. Varieties
// ---------------------------------------------------------------------------
console.log("\n[2/6] Varieties");
const { varieties } = readJson("cleanup_varieties.json");
const loadVarieties = varieties.map((v) => ({
  Variety_Name: v.variety_name,
  Plant_Id: v.plant_id,
  Characteristics: v.characteristics,
  Tasting_Notes: v.tasting_notes,
  Source: v.source,
}));
writeJson("load_varieties.json", loadVarieties);

// ---------------------------------------------------------------------------
// 3. Images (exclude excluded === true)
// ---------------------------------------------------------------------------
console.log("\n[3/6] Images");
const { images } = readJson("cleanup_images.json");
const filteredImages = images.filter((img) => img.excluded !== true);
console.log(`  Filtered: ${images.length} total → ${filteredImages.length} included (${images.length - filteredImages.length} excluded)`);
const loadImages = filteredImages.map((img) => ({
  File_Path: img.file_path,
  Plant_Id: img.plant_id,
  Caption: img.caption,
  Source_Directory: img.source_directory,
  Size_Bytes: img.size_bytes,
  Confidence: img.confidence,
  Excluded: img.excluded,
  Needs_Review: img.needs_review,
}));
writeJson("load_images.json", loadImages);

// ---------------------------------------------------------------------------
// 4. Documents
// ---------------------------------------------------------------------------
console.log("\n[4/6] Documents");
const { documents } = readJson("cleanup_documents.json");
const loadDocuments = documents.map((d) => ({
  Title: d.title,
  Doc_Type: d.doc_type,
  Content_Text: d.content_text,
  Content_Preview: d.content_preview,
  Plant_Ids: JSON.stringify(d.plant_ids),
  Original_File_Path: d.original_file_path,
  Is_Plant_Related: d.is_plant_related,
}));
writeJson("load_documents.json", loadDocuments);

// ---------------------------------------------------------------------------
// 5. Recipes
// ---------------------------------------------------------------------------
console.log("\n[5/6] Recipes");
const { recipes } = readJson("cleanup_recipes.json");
const loadRecipes = recipes.map((r) => ({
  Title: r.title,
  Ingredients: Array.isArray(r.ingredients) ? r.ingredients.join("\n") : r.ingredients,
  Method: r.method,
  Plant_Ids: JSON.stringify(r.plant_ids),
  Source_File: r.source_file,
  Needs_Review: r.needs_review,
}));
writeJson("load_recipes.json", loadRecipes);

// ---------------------------------------------------------------------------
// 6. OCR Extractions
// ---------------------------------------------------------------------------
console.log("\n[6/6] OCR Extractions");
const { extractions } = readJson("cleanup_ocr_extractions.json");
const loadOcr = extractions.map((e) => ({
  Title: e.title,
  Image_Path: e.image_path,
  Content_Type: e.content_type,
  Extracted_Text: e.extracted_text,
  Plant_Ids: JSON.stringify(e.plant_ids),
  Key_Facts: JSON.stringify(e.key_facts),
  Source_Context: e.source_context,
  Raw_Plant_Associations: JSON.stringify(e.raw_plant_associations),
}));
writeJson("load_ocr_extractions.json", loadOcr);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const summary = [
  ["load_plants.json", loadPlants.length],
  ["load_varieties.json", loadVarieties.length],
  ["load_images.json", loadImages.length],
  ["load_documents.json", loadDocuments.length],
  ["load_recipes.json", loadRecipes.length],
  ["load_ocr_extractions.json", loadOcr.length],
];

console.log("\n" + "=".repeat(50));
console.log("  SUMMARY — NocoDB load files");
console.log("=".repeat(50));
console.log("  File                         Records");
console.log("  " + "-".repeat(46));
for (const [file, count] of summary) {
  console.log(`  ${file.padEnd(30)} ${String(count).padStart(7)}`);
}
const total = summary.reduce((s, [, c]) => s + c, 0);
console.log("  " + "-".repeat(46));
console.log(`  ${"TOTAL".padEnd(30)} ${String(total).padStart(7)}`);
console.log("=".repeat(50));
console.log("\nDone.");
