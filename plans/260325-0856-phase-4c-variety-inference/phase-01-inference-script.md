# Phase 1: Inference Script (phase4c-infer-varieties.mjs)

**Priority:** Critical — blocks all other phases
**Status:** Not Started
**File to create:** `scripts/phase4c-infer-varieties.mjs`

---

## Context Links

- Phase 4B script (base to extend): `scripts/phase4b-infer-plants.mjs`
- Existing plant lookup logic: lines 66–281 of phase4b script
- NocoDB lib (server-side only): `review-ui/server/lib/nocodb.ts` — NOT usable in script
- NocoDB API: `https://nocodb.djjd.us`, token via env `NOCODB_API_KEY`
- Varieties table: 1,534 records with fields `Id`, `Variety_Name`, `Plant_Id`
- Table IDs: `content/parsed/nocodb_table_ids.json`
- Unclassified source: `content/pass_01/unassigned/unclassified/images/`
- Output: `content/parsed/phase4c_inferences.json`

---

## Overview

Extends Phase 4B's plant matching with a second pass that:
1. Fetches all Varieties from NocoDB (paginated, 200/page)
2. Builds a variety lookup dict: `normalizedVarietyName → { variety_id, variety_name, plant_id }`
3. Walks `unclassified/images/` — both flat files and subdirectory files
4. For each image: runs existing plant match logic PLUS new variety match logic
5. If variety match found: infers plant from `variety.Plant_Id` (overrides plant-only match)
6. Outputs JSON with full decision log

---

## Key Insights

- The unclassified directory has ~260 entries — many are subdirs (year folders, named plant dirs, gallery dirs)
- Need to walk recursively: `images/AvoBooth/file.jpg` → dir signal = "AvoBooth"
- Variety names in NocoDB use `Plant_Id` (text slug like "avocado") — same format as registry
- Phase 4B's `normalize()`, `normalizeLookup()`, `levenshtein()`, `STOP_WORDS` can be copied verbatim
- Must use `dotenv` to load `.env` for `NOCODB_API_KEY` — script runs outside Express context
- NocoDB Varieties endpoint: `GET /api/v1/db/data/noco/{baseId}/{tableId}?limit=200&offset=N`

---

## Script Architecture

```
phase4c-infer-varieties.mjs
├── loadEnv()              — dotenv, NOCODB_API_KEY
├── fetchAllVarieties()    — paginated NocoDB fetch, returns array
├── buildVarietyLookup()   — normalizedName → {variety_id, variety_name, plant_id}
├── buildPlantLookup()     — copy from 4B (registry + CSV)
├── walkUnclassified()     — recursive walk of unclassified/images/
├── inferImage(file)       — run variety match first, then plant match
├── matchVariety(tokens)   — exact → substring → fuzzy against variety lookup
├── matchPlant(tokens)     — copy from 4B match logic
└── writeOutput()          — phase4c_inferences.json
```

---

## Output JSON Format

```json
{
  "generated_at": "2026-03-25T...",
  "source_dir": "content/pass_01/unassigned/unclassified/images",
  "total_scanned": 3369,
  "matched": 847,
  "unmatched": 2522,
  "matches": [
    {
      "file_path": "content/pass_01/unassigned/unclassified/images/AvoBooth/IMG_001.jpg",
      "filename": "IMG_001.jpg",
      "parent_dir": "AvoBooth",
      "grandparent_dir": "unclassified",
      "plant_id": "avocado",
      "plant_name": "Avocado",
      "variety_id": 42,
      "variety_name": "Sharwil",
      "confidence": "high",
      "match_type": "variety_directory_exact",
      "signals": ["dir:AvoBooth → variety:Sharwil (avocado)"],
      "width": 1024,
      "height": 768,
      "file_size": 204800
    }
  ],
  "unmatched_files": [
    "content/pass_01/unassigned/unclassified/images/0489.gif"
  ]
}
```

---

## Match Types (ordered by priority)

| Priority | Type | Description |
|----------|------|-------------|
| 1 | `variety_directory_exact` | dir name exactly matches variety name |
| 2 | `variety_filename_exact` | filename stem exactly matches variety name |
| 3 | `variety_directory_substring` | variety name is substring of dir (or vice versa) |
| 4 | `variety_filename_substring` | variety name is substring of filename stem |
| 5 | `variety_directory_fuzzy` | Levenshtein ≤ 2 against dir name |
| 6 | `plant_directory_exact` | (fallback) 4B-style plant match from dir |
| 7 | `plant_filename_exact` | (fallback) 4B-style plant match from filename |
| 8 | `plant_directory_substring` | (fallback) |
| 9 | `plant_filename_substring` | (fallback) |
| 10 | `plant_directory_fuzzy` | (fallback) |

Variety matches always set `variety_id` + `plant_id`. Plant-only matches set `plant_id` only, `variety_id: null`.

---

## Confidence Levels

- **high**: exact or substring match on variety name, or exact plant match
- **medium**: fuzzy variety match (levenshtein ≤ 2), or substring plant match
- **low**: fuzzy plant match only

---

## Implementation Steps

1. Copy `normalize()`, `normalizeLookup()`, `levenshtein()`, stop words from phase4b
2. Add `dotenv` import and `NOCODB_API_KEY` loading (check `content/parsed/nocodb_table_ids.json` for table IDs)
3. Implement `fetchAllVarieties()` — paginate 200/page until `isLastPage`
4. Build variety lookup: for each variety, add `normalizeLookup(variety_name)` → entry
   - Skip varieties with names < 3 chars
   - Skip generic stop words
5. Walk `unclassified/images/` recursively using `fs.readdirSync` with depth tracking
   - Collect: `{ file_path, filename, parent_dir, grandparent_dir }`
   - Filter: images only (jpg, jpeg, gif, png)
6. For each file: extract tokens = `[filename_stem, parent_dir, grandparent_dir]`
7. Run variety match: iterate token list, try exact → substring → fuzzy
8. If no variety match: run 4B-style plant match
9. Get image dimensions using `sharp` or native — check if `sharp` is in package.json
10. Write output JSON

---

## Todo

- [ ] Check if `sharp` is available in package.json for image dimensions
- [ ] Verify `dotenv` is available in root package.json (not just review-ui)
- [ ] Test NocoDB Varieties pagination with real API call
- [ ] Confirm `nocodb_table_ids.json` has `Varieties` key
- [ ] Handle year-named dirs ("2007 fruit shoot") — these should not match plants
- [ ] Test with known variety names (e.g., "Sharwil" avocado, "Hass")

---

## Risk Assessment

- **Variety name collisions**: "Golden" matches many fruits — apply same genericLookupTerms filter
- **Year dirs**: "2007", "2008" etc. must not match variety names — `normalize()` strips trailing numbers but parent dir "2007 fruit shoot" normalizes to "fruit shoot" which could match; add "fruit shoot" to stop words
- **NocoDB rate limits**: 1,534 varieties = ~8 pages at 200/page — no throttling needed
- **Missing Plant_Id**: some varieties may have null Plant_Id — skip those

---

## Success Criteria

- Script runs to completion without errors
- Output JSON is valid and parseable
- Variety match rate ≥ 15% of scanned images (rough estimate based on named subdirs)
- Plant-only match rate ≥ 25% (similar to 4B rate on this pool)
- No false positives on year-named directories
