# Phase 4C: Variety Inference & Match Review UI

**Status:** Not Started
**Scope:** ~3,369 images in `content/pass_01/unassigned/unclassified/images/`
**Goal:** Infer plant + variety from filename/directory signals → human review → assign to DB + filesystem

---

## Executive Summary

Phase 4B matched ~44% of unclassified images to plants using filename/directory fuzzy matching. Phase 4C extends this with:
1. **Variety inference** — match against NocoDB Varieties table (1,534 records) to infer both plant and variety
2. **Targeted review UI** — line-by-line approve/review/ignore workflow for the inferred matches

Expected impact: classify 500–1,500 more images with variety-level precision, reducing manual triage burden. The unclassified pool has ~260 subdirectory-level signals (year folders, shoot folders, named fruit dirs) that should yield meaningful matches.

Key constraint: unclassified images are NOT flat — they're in subdirectories (`2007 fruit shoot/`, `12trees/`, named plant dirs). The directory structure is the primary signal.

---

## Phases

| Phase | File | Status |
|-------|------|--------|
| Phase 1: Inference Script | [phase-01-inference-script.md](phase-01-inference-script.md) | Not Started |
| Phase 2: Backend API | [phase-02-backend-api.md](phase-02-backend-api.md) | Not Started |
| Phase 3: Review UI | [phase-03-review-ui.md](phase-03-review-ui.md) | Not Started |

---

## Build Order

1. **Script first** — run Phase 4C script to generate `phase4c_inferences.json`
2. **Backend API** — new route file `review-ui/server/routes/matches.ts`
3. **Frontend page** — new page `MatchReviewPage.tsx` + route in App.tsx

Each phase is independently testable. Start with the script since everything else depends on its output format.

---

## Key Decisions

- Script reads NocoDB Varieties directly via HTTP (not from a cached file) for freshness
- Output JSON lives at `content/parsed/phase4c_inferences.json`
- Backend serves matches from JSON file (no SQLite — stateless, re-runnable)
- Approve action reuses existing `POST /api/browse/upload-images/:plantId` endpoint
- Undo stack is in-memory frontend state only (no server-side undo log needed)
- `_to_triage` and `ignored` folders created at `content/pass_01/unassigned/` level

---

## Data Flow

```
[Script] phase4c-infer-varieties.mjs
    ↓ reads: unclassified/images/* + NocoDB Varieties API + plant_registry.json
    ↓ writes: content/parsed/phase4c_inferences.json

[Backend] GET /api/matches
    ↓ reads: phase4c_inferences.json
    ↓ returns: grouped by folder, with image metadata

[Frontend] MatchReviewPage
    ↓ displays: thumbnail, filename, signals, plant+variety dropdowns
    ↓ actions: Approve (a) → POST upload-images, Review (r) → move to _to_triage, Ignore (i) → move to ignored

[Backend] POST /api/matches/approve | /review | /ignore | /undo
    ↓ approve: calls upload logic, moves file, updates DB
    ↓ review/ignore: moves file to target folder
    ↓ undo: reverses last action
```
