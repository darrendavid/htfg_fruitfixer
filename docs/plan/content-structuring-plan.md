# Plan: Structure HawaiiFruit.net Content Archive into a Searchable Fruit Database

## Context

The `content/source/` directory contains ~31,000 files (images, HTML, documents, spreadsheets) accumulated over 30 years of Hawaii tropical fruit documentation by Ken Love / Hawaii Tropical Fruit Growers. The data lives in two main trees:
- `content/source/original/` — raw source photos and documents in ~110 plant-named folders (41 GB)
- `content/source/HawaiiFruit. Net/` — the published website with ~186 gallery directories, index pages, and standalone files (4.7 GB)

All structured output goes to `content/parsed/`.

**Goal:** Transform this unstructured archive into a searchable, structured plant database backed by NocoDB, with organized image storage and structured metadata per plant.

**Key decisions:**
- **Storage:** NocoDB (via MCP server) for the queryable/editable backend
- **Images:** Copy into `content/parsed/` organized directory structure (sources in `content/source/` stay untouched)
- **Scope:** All plants, not just fruits (coffee, spices, flowers, nuts included)
- **Recipes:** Separate entity with many-to-many plant associations

---

## Phase 1: Build the Canonical Plant Registry

**Goal:** Establish a single authoritative list of every plant documented in the archive.

**Steps:**
1. **Harvest existing structured lists** — Extract plant names, botanical names, and harvest months from:
   - `content/source/HawaiiFruit. Net/fruit-time.htm` (~100 plants with Latin names and monthly availability)
   - `Jcitruslist.htm` (80+ Japanese citrus varieties with botanical names)
   - XLS files: `Hawaiian Banana Varieties.xls`, `VarietyDatabase03.xls`, `Varietyname.xls`, `figtastescale.xls`
2. **Scan directory names** — Programmatically collect all directory names from both content trees that appear to be plant names. Cross-reference against extracted lists.
3. **Normalize and deduplicate** — Merge variant spellings and alternate names (e.g., "biwa" = loquat, "eggfruit" = canistel, "chico" = sapodilla). Assign each a canonical name and botanical name where known.
4. **Categorize non-plant directories** — Flag directories that are events, conferences, or general topics (not individual plants). Tag them as `topic` rather than `plant`.

**Output:** `content/parsed/plant_registry.json` — fields: `id`, `canonical_name`, `botanical_name`, `aliases[]`, `family`, `category` (fruit/nut/spice/flower/other), `source_directories[]`.

---

## Phase 2: File Inventory & Classification

**Goal:** Catalog every file with its type, plant association, and content category.

**Steps:**
1. **Walk the entire file tree** — Record every file: path, extension, size, parent directory.
2. **Classify by file type:**
   - **Images** (JPG, GIF, PNG) → photo assets
   - **Design files** (PSD) → source artwork
   - **Documents** (DOC, DOCX, PDF, PPT, XLS) → reference/research material
   - **Web content** (HTML, HTM) → structured text to extract
   - **Metadata** (desktop.ini, UserSelections.txt, CSS, JS) → skip
   - **Other** (EML, TXT) → manual review
3. **Associate files with plants** — Match each file to a plant from the registry using:
   - Parent directory name (strongest signal)
   - Filename keywords
   - For HTML: parse `<title>` and headings
4. **Flag ambiguous files** — Items that can't be confidently matched get `needs_review: true` with a reason.
5. **Detect duplicates** — Identify files existing in both `content/source/original/` and `content/source/HawaiiFruit. Net/` (the `original/fruit pix/` subtree appears to partially mirror `original/`).

**Output:** `content/parsed/file_inventory.json` — fields: `path`, `type`, `size_bytes`, `plant_id` (nullable), `content_category`, `confidence`, `needs_review`, `duplicate_of` (nullable).

---

## Phase 3: Content Extraction

**Goal:** Extract structured text data from HTML, documents, and spreadsheets.

**Steps:**
1. **Parse fruit-time.htm** → harvest calendar: plant → months available
2. **Parse fruitdata/ pages** (~70 pages) → per-plant descriptions, images, nutritional references
3. **Parse index pages** → links and section descriptions from `indexdata.html`, `indexavo.html`, `index-figs.html`, `indexstonefruit.html`, `index-recipes.html`
4. **Parse article pages** → growing guides, harvest instructions, research notes from standalone .htm files (`pickguide.htm`, `HarvestattheRighttime.htm`, recipe pages)
5. **Extract XLS data** → variety databases, taste scales, classification data
6. **Extract from PDFs** → text from ~37 PDF files (posters, publications, papers)
7. **Parse recipe pages** → structured recipe data: title, ingredients, method, associated plants

**Output:** Enriched plant records in `content/parsed/plant_registry.json`. Separate `content/parsed/recipes.json` with: `title`, `ingredients`, `method`, `plant_ids[]`, `source_file`.

---

## Phase 4: Image Organization

**Goal:** Copy images into a clean organized structure and build an image manifest.

**Steps:**
1. **Create target directory structure:**
   ```
   content/parsed/
     plants/
       abiu/
         images/
       acerola/
         images/
       ...
     topics/
       conferences/
       recipes/
       ...
     unclassified/
   ```
2. **Copy gallery images** — For Adobe Web Photo Gallery directories, copy full-size images from `images/` and thumbnails from `thumbnails/` into the appropriate plant folder under `content/parsed/`.
3. **Copy standalone images** — Loose images from `content/source/original/` and `content/source/HawaiiFruit. Net/` root, placed by plant association.
4. **Generate image manifest** — Per plant: list of images with original path, new path, dimensions, source.
5. **Handle unclassified** — Images with no plant match go to `unclassified/` for human review.
6. **Skip duplicates** — When the same image exists in multiple locations, copy only once and note aliases.

**Output:** Organized `content/parsed/` directory tree. Updated `content/parsed/file_inventory.json` with `new_path` field.

---

## Phase 4B: Fuzzy Plant Inference for Unclassified Images

**Goal:** Infer plant associations for images left unclassified by Phase 4, using fuzzy matching against an expanded reference vocabulary.

**Steps:**
1. **Build expanded lookup dictionary** from the plant registry (140 plants) and `docs/reference/tropical_fruits_v10.csv` (1,334 rows with fruit types, varieties, scientific names, and alternative names).
2. **Match unclassified images** using 6 strategies in priority order:
   - Directory name exact match (high confidence)
   - Directory name substring match (high/medium confidence)
   - Directory name fuzzy match via Levenshtein distance ≤ 2 (medium confidence)
   - Filename substring match (medium confidence)
   - Filename word fuzzy match (low confidence)
   - Compound directory split on `&`, `+`, `,` (low confidence)
3. **Apply name normalization**: lowercase, remove diacritics, replace separators, strip generic suffixes/prefixes.
4. **Filter false positives** with stop word lists (colors, UI terms, geography) and generic lookup term exclusions.
5. **Log every inference** with reasoning for Phase 5 human review.

**Output:**
- `content/parsed/phase4b_inferences.json` — 6,518 inferred matches with decision log
- `content/parsed/phase4b_still_unclassified.json` — 8,361 images still unmatched
- `content/parsed/phase4b_new_plants.json` — 72 plants from CSV not in registry
- `content/parsed/phase4b_summary.json` — statistics and confidence breakdown

---

## Phase 5: Human Review (Separate Subproject)

**Goal:** Resolve ambiguities that automation can't handle via a mobile-friendly web UI.

This phase will be scoped separately — when we reach it, we'll engage the product-strategy-advisor to generate a PRD for a mobile-friendly web application that knowledgeable staff can use to:
- View unclassified/ambiguous files with context (neighbors, partial matches)
- Assign files to plants, mark as discard, or create new plant entries
- Review and confirm Phase 4B inferences (accept/reject fuzzy matches)
- Review and confirm duplicate detection
- Handle multi-plant content (conference photos, display images)

The automated phases (1–4B) will produce the review queue data that feeds into this UI.

**Output:** Resolved inventory via human-assisted classification.

---

## Phase 6: OCR Content Extraction

**Goal:** Extract agronomic text from images flagged by the OCR triage scanner (posters, data sheets, variety labels, signage) and use the extracted content to inform the database schema before populating it.

**Prerequisites:** Phase 5 (human review), OCR triage complete (`ocr_candidates.json` — 605 images with data-indicator words).

**Steps:**
1. **Send flagged images to Claude** — For each candidate in `ocr_candidates.json`, send the image to Claude with a prompt to extract structured content: variety names, growing data, harvest info, research findings, nutritional facts, or any other agronomic text visible in the image.
2. **Structure extracted content** — Claude returns structured fields per image: `title`, `content_type` (poster/data-sheet/label/sign/table), `extracted_text`, `plant_associations[]`, `key_facts[]` (name-value pairs like "Brix: 18", "Spacing: 20ft"), `source_context` (conference, research station, etc.).
3. **Human review of extractions** — Flag low-confidence or ambiguous extractions for review in the Phase 5 UI (add an "OCR Review" queue type).
4. **Schema analysis** — Review the extracted fields across all 605 images to identify recurring structured data (variety attributes, trial measurements, growing conditions) that should become columns in the NocoDB schema rather than unstructured text blobs.

**Output:**
- `content/parsed/phase6_ocr_extractions.json` — structured content from all 605 candidate images
- Schema recommendations for Phase 7 NocoDB table design (e.g., new Variety fields, measurement tables)

---

## Phase 7: NocoDB Population

**Goal:** Load all structured data into NocoDB tables via MCP server, with schema informed by Phases 3 and 6.

**Steps:**
1. **Create NocoDB tables:**

   **Core plant tables:**
   - **Plants** — id, canonical_name, botanical_name, family, category, aliases (text/JSON), description, harvest_months (text/JSON), tasting_notes, pairs_well_with (plant_id links)
   - **Varieties** — id, plant_id (link), variety_name, characteristics, tasting_notes, source
   - **Nutritional_Info** — id, plant_id (link), nutrient_name, value, unit, per_serving, source — separate table to enable searching/sorting by nutritional values

   **Geography:**
   - **Geographies** — id, island (Hawai'i/Maui/O'ahu/Kaua'i/Moloka'i/Lāna'i), district (official 9-district system: North Hilo, South Hilo, Puna, Ka'u, South Kona, North Kona, South Kohala, North Kohala, Hamakua + equivalent for other islands), moku (traditional 6 moku: Hilo, Puna, Ka'ū, Kona, Kohala, Hāmākua), subregion (town/area: Kailua-Kona, Waimea, Pāhoa, etc.), elevation_zone (CTAHR: low <2000ft, high 2000-4500ft), rainfall_zone (dry <40in, moderate 40-100in, wet >100in), notes
   - **Plant_Geographies** — plant_id (link), geography_id (link), context (native/cultivated/trial/commercial) — many-to-many junction

   **Growing & cultivation:**
   - **Growing_Notes** — id, plant_id (link), geography_id (link, optional), climate_zone, soil_type, spacing, irrigation, notes, source — separate table since growing conditions vary by location
   - **Pests** — id, common_name, scientific_name, description, signs_on_plant, treatments (text/JSON), geographic_locations (text/JSON)
   - **Pest_Images** — id, pest_id (link), image_path, caption, image_type (pest_photo/damage_sign/lifecycle)
   - **Plant_Pests** — plant_id (link), pest_id (link) (many-to-many junction)
   - **Diseases** — id, common_name, pathogen_type (fungal/bacterial/viral), description, symptoms, treatments (text/JSON), geographic_locations (text/JSON)
   - **Disease_Images** — id, disease_id (link), image_path, caption, image_type (symptom/pathogen/lifecycle)
   - **Plant_Diseases** — plant_id (link), disease_id (link) (many-to-many junction)

   **Content & media:**
   - **Images** — id, plant_id (link), file_path, thumbnail_path, caption, source_directory
   - **Documents** — id, plant_id (link), title, doc_type (recipe/research/guide/poster), content_text, original_file_path
   - **Recipes** — id, title, ingredients, method, source_file
   - **Recipe_Plants** — recipe_id (link), plant_id (link) (many-to-many junction)
   - **OCR_Extractions** — id, image_id (link), plant_id (link), content_type, extracted_text, key_facts (JSON), source_context
   - **FAQ** — id, plant_id (link), question, answer, source

   **Metadata:**
   - **Tags** — for cross-cutting metadata (region, conference, culinary application)
   - Additional tables/columns as identified by Phase 6 schema analysis

2. **Load data** — Use NocoDB MCP tools to create tables and insert records from the JSON checkpoint files, including Phase 6 OCR extractions.
3. **Link records** — Establish relationships between plants, images, documents, recipes, and OCR extractions.
4. **Verify** — Spot-check a sample of plants to ensure data integrity.

---

## Implementation Notes

- **Language:** Node.js (ES modules) for all processing scripts.
- **Key libraries:**
  - **cheerio** — HTML parsing (jQuery-like API, fast and reliable)
  - **xlsx / SheetJS** — Excel file reading
  - **pdf-parse** — PDF text extraction for simple cases; for complex/scanned PDFs, delegate to a specialized Python script (called via `child_process`) using PyMuPDF
  - **sharp** — Image metadata and thumbnail generation
  - **fast-glob** — File tree walking with glob patterns
  - **fs/promises + path** — File operations with proper space/special-character handling
- **Path handling:** All paths contain spaces and special characters — use `path.join()` throughout, never string concatenation.
- **Checkpointing:** Each phase writes a JSON file consumed by the next. Phases are independently re-runnable.
- **Scale:** ~31,000 files total. Each processing phase should complete in minutes on a local machine.
- **NocoDB MCP:** Will use the MCP server tools to interact with NocoDB for table creation and data population in Phase 7.

## Agents

### Specialized Agents (`.claude/agents/`)

| Agent | Phases | Purpose | Model |
|-------|--------|---------|-------|
| `content-inventory-scanner` | 1, 2 | Walk trees, catalog files, detect duplicates, associate with plants | haiku |
| `html-content-extractor` | 3 | Parse HTML for harvest data, descriptions, recipes, links | sonnet |
| `document-parser` | 3 | Extract from XLS, PDF, TXT; Python fallback for complex PDFs | sonnet |
| `image-organizer` | 4 | Copy/organize images, extract metadata, generate thumbnails | haiku |
| `nocodb-data-loader` | 7 | Create schemas, batch-load data, link relationships via MCP | sonnet |

### Existing Agents to Leverage
- **`product-strategy-advisor`** — Phase 5: Generate PRD for mobile review UI
- **`system-architect`** — Phase 7: Validate NocoDB schema design
- **`prd-breakdown-execute`** — Phase 5: Break down and execute the review UI subproject

## Verification

After each phase:
- Phase 1: Review plant_registry.json — check count (~150+ plants), spot-check botanical names
- Phase 2: Review file_inventory.json — verify counts by type, check association rates
- Phase 3: Spot-check extracted text for a few well-known fruits (mango, avocado, fig)
- Phase 4: Browse the structured/ directory — verify images are correctly placed
- Phase 5: Review queue should be manageable (<500 items needing human input)
- Phase 6: Review OCR extractions — verify structured fields extracted from posters/signs, check schema recommendations
- Phase 7: Query NocoDB tables — search for specific plants, verify linked images, documents, and OCR data
