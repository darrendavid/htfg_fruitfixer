---
name: Phase 4B Known Matching Issues
description: Specific mismatches identified during triage that need to be fixed in the next Phase 4B re-run
type: project
---

Known directory mismatches from human triage review (2026-03-16):

- `mysore/` → incorrectly matched banana; should be **mysore raspberry** (Rubus niveus)
- `poha bush/` → not matching; should be **poha berry** (Physalis peruviana, also "poha")
- `Pome/zakuo` → matched wrong; is **Zakuro Pomegranate** (zakuro = pomegranate in Japanese; "Pome" + "zakuo" compound)
- `strawg/` → not matched; abbreviation for **strawberry guava** (Psidium cattleianum)
- `surinam/` → not matched; should be **surinam cherry** (Eugenia uniflora)
- `oahutrees/` → mixed-fruit directory; each photo is a different fruit — should use scientific name from caption/alt text to match individually

**Why:** These mismatches reveal gaps in:
1. The reference CSV (missing some entries or alternate names)
2. Stop-word over-filtering (short names like "poha" may be filtered)
3. Compound directory name splitting logic (Pome+zakuo not recognized)
4. Abbreviation lookup (strawg, surinam not in alias list)

**How to apply:** When running the next Phase 4B re-run, add these as manual overrides in the script's `DIR_OVERRIDES` constant, and check the reference CSV for missing entries. Also check genericLookupTerms — "poha" should NOT be filtered.
