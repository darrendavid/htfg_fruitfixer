# Phase 2: Backend API (matches route)

**Priority:** High — required before frontend
**Status:** Not Started
**File to create:** `review-ui/server/routes/matches.ts`
**File to modify:** `review-ui/server/index.ts` (register route)

---

## Context Links

- Route pattern reference: `review-ui/server/routes/browse.ts`
- Upload logic reference: `review-ui/server/routes/browse.ts` lines 279–322 (`upload-images` endpoint)
- nocodb helper: `review-ui/server/lib/nocodb.ts`
- Config: `review-ui/server/config.ts` — `IMAGE_MOUNT_PATH`, `CONTENT_ROOT`
- Inference output: `content/parsed/phase4c_inferences.json`
- Unclassified source: `content/pass_01/unassigned/unclassified/images/`
- Assigned target: `content/pass_01/assigned/{plantId}/images/`
- Triage target: `content/pass_01/unassigned/_to_triage/`
- Ignored target: `content/pass_01/unassigned/ignored/`

---

## Overview

New route file `matches.ts` with 5 endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/matches` | Load all matches from JSON, grouped by folder |
| POST | `/api/matches/approve` | Upload image to plant dir + create Images DB record + delete source |
| POST | `/api/matches/review` | Move image to `_to_triage/` folder |
| POST | `/api/matches/ignore` | Move image to `ignored/` folder |
| POST | `/api/matches/undo` | Reverse last action (move file back, delete DB record if created) |

All write endpoints require `requireAdmin`. GET requires `requireAuth`.

---

## GET /api/matches

**Response shape:**

```typescript
{
  total: number;
  matched: number;
  unmatched: number;
  groups: MatchGroup[];
}

interface MatchGroup {
  folder: string;           // parent_dir value, e.g. "AvoBooth"
  count: number;
  matches: MatchItem[];
}

interface MatchItem {
  file_path: string;        // full path from JSON
  filename: string;
  parent_dir: string;
  plant_id: string;
  plant_name: string;
  variety_id: number | null;
  variety_name: string | null;
  confidence: 'high' | 'medium' | 'low';
  match_type: string;
  signals: string[];
  width: number | null;
  height: number | null;
  file_size: number;
  status?: 'pending' | 'approved' | 'reviewed' | 'ignored'; // derived from filesystem
}
```

**Implementation notes:**
- Read `phase4c_inferences.json` fresh on each request (file may be re-run between sessions)
- Group by `parent_dir`, sort groups by folder name
- Check if source file still exists — if not, mark `status` accordingly so UI can skip it
- No caching — file is ~3MB max, reads are fast

---

## POST /api/matches/approve

**Request body:**
```typescript
{
  file_path: string;      // full path to source file
  plant_id: string;       // slug, e.g. "avocado"
  variety_id?: number;    // optional NocoDB Varieties.Id
  title?: string;         // optional, defaults to filename stem
  attribution?: string;   // optional
  license?: string;       // optional
}
```

**Logic (mirrors existing upload-images endpoint):**
1. Validate source file exists
2. Resolve dest dir: `IMAGE_MOUNT_PATH/{plant_id}/images/`
3. Create dir if needed (`mkdirSync recursive`)
4. Handle filename collision (append `_1`, `_2` suffix)
5. Copy file to dest (`fs.copyFileSync`)
6. Create Images record in NocoDB:
   ```typescript
   {
     Plant_Id: plant_id,
     Variety_Id: variety_id || null,
     File_Path: `content/pass_01/assigned/${plant_id}/images/${filename}`,
     File_Name: filename,
     Title: title || filename_stem,
     Attribution: attribution || config.IMAGES_AUTO_ATTRIBUTION || null,
     License: license || null,
     Width: width_from_json,
     Height: height_from_json,
     File_Size: file_size_from_json,
   }
   ```
7. Delete source file (`fs.unlinkSync`)
8. Return: `{ success: true, nocodb_id: record.Id, dest_path: string }`

**Undo support:** Return `{ undo_token: { type: 'approve', nocodb_id, dest_path, original_path } }`

---

## POST /api/matches/review

**Request body:** `{ file_path: string }`

**Logic:**
1. Validate source file exists
2. Ensure `content/pass_01/unassigned/_to_triage/` exists
3. Resolve unique dest filename (handle collisions)
4. Move file: `fs.renameSync(src, dest)` — fallback to copy+delete if cross-device
5. Return: `{ success: true, dest_path, undo_token: { type: 'review', dest_path, original_path } }`

---

## POST /api/matches/ignore

**Request body:** `{ file_path: string }`

**Logic:** Same as review but target is `content/pass_01/unassigned/ignored/`

---

## POST /api/matches/undo

**Request body:**
```typescript
{
  undo_token: {
    type: 'approve' | 'review' | 'ignore';
    original_path: string;   // where to move file back to
    dest_path: string;       // current location of file
    nocodb_id?: number;      // for approve: Images record to delete
  }
}
```

**Logic by type:**
- `approve`: delete NocoDB Images record → move file from dest back to original
- `review`: move file from `_to_triage/` back to original
- `ignore`: move file from `ignored/` back to original

**Notes:**
- If `original_path` dir no longer exists, recreate it
- If dest file doesn't exist (already moved again), return 409 with error

---

## File: review-ui/server/routes/matches.ts

Structure:

```typescript
import { Router } from 'express';
import path from 'path';
import { readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'fs';
import { requireAuth, requireAdmin } from '../middleware/index.js';
import { nocodb } from '../lib/nocodb.js';
import { config } from '../config.js';

const router = Router();

// Resolve path to phase4c_inferences.json
function getInferencesPath(): string { ... }

// Load and parse inferences JSON
function loadInferences(): Phase4cOutput { ... }

// Unique filename helper (handle collisions)
function uniqueDest(dir: string, filename: string): string { ... }

// Safe move (handles cross-device by copy+delete)
function moveFile(src: string, dest: string): void { ... }

router.get('/', asyncHandler(async (req, res) => { ... }));
router.post('/approve', requireAdmin, asyncHandler(async (req, res) => { ... }));
router.post('/review', requireAdmin, asyncHandler(async (req, res) => { ... }));
router.post('/ignore', requireAdmin, asyncHandler(async (req, res) => { ... }));
router.post('/undo', requireAdmin, asyncHandler(async (req, res) => { ... }));

export default router;
```

---

## Modify: review-ui/server/index.ts

Add after line 61 (`app.use('/api/browse', ...)`):
```typescript
import matchesRouter from './routes/matches.js';
// ...
app.use('/api/matches', requireAuth, matchesRouter);
```

---

## Implementation Steps

1. Create `review-ui/server/routes/matches.ts` with all 5 endpoints
2. Add import + `app.use` in `review-ui/server/index.ts`
3. Test GET endpoint manually: verify grouping + file existence check works
4. Test approve with a real image: verify NocoDB record created, file moved
5. Test undo approve: verify NocoDB record deleted, file returned

---

## Todo

- [ ] Confirm `Images` NocoDB table field names (check existing upload-images usage in browse.ts)
- [ ] Confirm `content/parsed/nocodb_table_ids.json` has `Images` key
- [ ] Decide: should approve increment `Image_Count` on Plants table? (check if it's auto-computed in NocoDB or manually maintained)
- [ ] Handle the case where `phase4c_inferences.json` does not exist yet (return empty response, not 500)
- [ ] Add `UNASSIGNED_PATH` or derive it from `IMAGE_MOUNT_PATH` (`../unassigned`)

---

## Risk Assessment

- **Cross-device move**: `IMAGE_MOUNT_PATH` and `unassigned/` are both under `content/pass_01/` so same volume — `renameSync` should work. Add copy+delete fallback to be safe.
- **Concurrent approvals**: Two admins approving same file simultaneously — last one to copy wins, first NocoDB record is orphaned. Acceptable risk for this workflow (single-admin in practice).
- **Image_Count staleness**: If NocoDB maintains this as a formula/rollup field, no action needed. If it's a manual counter, we should increment it on approve.
- **File path portability**: `file_path` in JSON uses OS separators from script. Normalize to forward slashes in API response.

---

## Success Criteria

- GET `/api/matches` returns grouped data with correct file existence checks
- POST `/api/matches/approve` creates NocoDB record, moves file, returns undo token
- POST `/api/matches/undo` reverses approve: NocoDB record gone, file back in original location
- All endpoints return structured JSON errors (not 500 stack traces) for missing files
