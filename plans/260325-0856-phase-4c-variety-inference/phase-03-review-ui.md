# Phase 3: Review UI (MatchReviewPage)

**Priority:** High — depends on Phase 2
**Status:** Not Started
**Files to create:**
- `review-ui/src/pages/MatchReviewPage.tsx`
- `review-ui/src/components/matches/MatchCard.tsx`
- `review-ui/src/components/matches/MatchGroupHeader.tsx`
- `review-ui/src/types/matches.ts`
**Files to modify:**
- `review-ui/src/App.tsx` (add route `/matches`)
- `review-ui/src/components/layout/AppShell.tsx` or nav component (add nav link)

---

## Context Links

- PlantAutocomplete: `review-ui/src/components/browse/PlantAutocomplete.tsx`
- VarietyPicker: `review-ui/src/components/browse/VarietyAutocomplete.tsx`
- OcrReviewPage (keyboard workflow reference): `review-ui/src/pages/OcrReviewPage.tsx`
- AppShell: `review-ui/src/components/layout/AppShell.tsx`
- Backend API: Phase 2 plan (`phase-02-backend-api.md`)
- ShadCN components available: Button, Badge, Skeleton, Input, Progress

---

## Overview

Single-page review UI at `/matches`. Loads all inferred matches from `GET /api/matches`, displays them grouped by folder. Keyboard-driven workflow: navigate with arrow keys, act with `a` / `r` / `i`, undo with `Ctrl+Z`.

**Layout:** Two-column — left panel = folder list / progress, right panel = match cards for selected folder.

---

## Page Structure

```
MatchReviewPage
├── Header bar: title, stats (X approved / Y remaining), progress bar
├── Left sidebar: folder list (grouped, with counts + status badges)
└── Right panel: match cards for selected folder
    └── MatchCard (per image)
        ├── Thumbnail (lazy, 120×90px)
        ├── Filename + resolution + size
        ├── Confidence badge (high/medium/low → green/yellow/orange)
        ├── Signals list (e.g. "dir:AvoBooth → variety:Sharwil")
        ├── PlantAutocomplete (pre-filled with inferred plant)
        ├── VarietyPicker (pre-filled with inferred variety, depends on plant)
        └── Action buttons: [Approve (a)] [To Triage (r)] [Ignore (i)]
```

---

## Types (review-ui/src/types/matches.ts)

```typescript
export interface MatchItem {
  file_path: string;
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
  status?: 'pending' | 'approved' | 'reviewed' | 'ignored';
}

export interface MatchGroup {
  folder: string;
  count: number;
  matches: MatchItem[];
}

export interface MatchesResponse {
  total: number;
  matched: number;
  unmatched: number;
  groups: MatchGroup[];
}

export interface UndoToken {
  type: 'approve' | 'review' | 'ignore';
  original_path: string;
  dest_path: string;
  nocodb_id?: number;
  filename: string;
}
```

---

## Component: MatchCard.tsx

**Props:**
```typescript
interface MatchCardProps {
  item: MatchItem;
  isActive: boolean;          // keyboard focus on this card
  onApprove: (item: MatchItem, plantId: string, varietyId: number | null) => void;
  onReview: (item: MatchItem) => void;
  onIgnore: (item: MatchItem) => void;
  onRef: (el: HTMLDivElement | null) => void;  // for scroll-into-view
}
```

**State:**
- `selectedPlant: PlantSuggestion | null` — initialized from `item.plant_id` + `item.plant_name`
- `selectedVariety: VarietySelection | null` — initialized from `item.variety_id` + `item.variety_name`
- `isSubmitting: boolean`

**Key behaviors:**
- Pre-populates PlantAutocomplete display with `item.plant_name` (read-only label until user clicks to change)
- VarietyPicker only renders when `selectedPlant` is set (needs `plantId` prop)
- When plant changes, reset variety to null
- Action buttons call parent handlers with current `selectedPlant.Id1` and `selectedVariety?.id`
- Scroll into view when `isActive` becomes true
- Show spinner overlay while `isSubmitting`

**Thumbnail:**
- Path: `/images/pass_01/unassigned/unclassified/images/{parent_dir}/{filename}` — but this won't work since `/images` serves `assigned/`
- Need a new static route OR a dedicated endpoint: `GET /api/matches/thumbnail?path=...`
- Simplest: add a content-files style route in server for unassigned dir

---

## Keyboard Navigation

**Global hotkeys** (captured via `useEffect` on `document`):

| Key | Action |
|-----|--------|
| `ArrowDown` / `j` | Move to next match card |
| `ArrowUp` / `k` | Move to previous match card |
| `a` | Approve focused card (with current plant/variety) |
| `r` | Move focused card to triage |
| `i` | Ignore focused card |
| `Ctrl+Z` | Undo last action |
| `Tab` | Focus plant autocomplete on active card |
| `v` | Focus variety picker on active card |

**Keyboard guard:** Suppress global hotkeys when focus is inside an input/textarea (check `document.activeElement.tagName`).

---

## Undo Stack

```typescript
const [undoStack, setUndoStack] = useState<UndoToken[]>([]);

// On successful action: push to undo stack (max 20 items)
// On Ctrl+Z: pop from stack, POST /api/matches/undo, restore item to UI
```

Undo restores the item to its original position in the list (insert back at same index) with `status: 'pending'`. No server-side undo persistence needed.

---

## State Management

```typescript
// Page-level state
const [groups, setGroups] = useState<MatchGroup[]>([]);
const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
const [activeIndex, setActiveIndex] = useState(0);
const [undoStack, setUndoStack] = useState<UndoToken[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [actionCounts, setActionCounts] = useState({ approved: 0, reviewed: 0, ignored: 0 });

// Derived
const activeGroup = groups.find(g => g.folder === selectedFolder);
const activeMatches = activeGroup?.matches.filter(m => m.status === 'pending') ?? [];
const activeItem = activeMatches[activeIndex] ?? null;
```

When an action is taken: update the item's `status` in local state immediately (optimistic). If API call fails, revert.

---

## Thumbnail Access

The existing `/images` static route serves `IMAGE_MOUNT_PATH` = `content/pass_01/assigned/`. Unclassified images are at `content/pass_01/unassigned/unclassified/images/`.

**Solution:** Add a new static route in `server/index.ts`:
```typescript
const unassignedPath = path.resolve(config.IMAGE_MOUNT_PATH, '..', 'unassigned');
app.use('/unassigned-images', requireAuth, express.static(unassignedPath),
  (_req, res) => res.sendStatus(404));
```

Then thumbnail URL = `/unassigned-images/unclassified/images/{parent_dir}/{filename}`

This is a one-line addition, no new endpoint needed.

---

## Implementation Steps

1. Create `review-ui/src/types/matches.ts`
2. Add `/unassigned-images` static route to `server/index.ts`
3. Create `MatchGroupHeader.tsx` — simple folder name + count + completion badge
4. Create `MatchCard.tsx` — thumbnail, metadata, plant/variety pickers, action buttons
5. Create `MatchReviewPage.tsx` — two-column layout, keyboard handler, undo stack
6. Add route to `App.tsx`: `<Route path="/matches" element={<MatchReviewPage />} />`
7. Add nav link in AppShell (check current nav structure)

---

## Reuse Analysis

| Component | Reuse | Notes |
|-----------|-------|-------|
| `PlantAutocomplete` | Direct reuse | Pass `onSelect`, no `confirmMessage` needed |
| `VarietyPicker` | Direct reuse | Requires `plantId` prop — render conditionally |
| `AppShell` | Wrap page in it | Same as OcrReviewPage |
| `AuthGuard` | Wrap page in it | Same as all other pages |
| `LazyImage` | Direct reuse | Already handles loading states |
| `Badge` (ShadCN) | For confidence level | `variant="outline"` with color class |
| `Progress` (ShadCN) | Header progress bar | `value={approvedCount / totalCount * 100}` |
| `Skeleton` | Loading state | While groups load |

**New builds:**
- `MatchCard.tsx` — ~120 lines
- `MatchGroupHeader.tsx` — ~30 lines
- `MatchReviewPage.tsx` — ~180 lines (split if >200 lines)
- `types/matches.ts` — ~40 lines

---

## Todo

- [ ] Check `App.tsx` route patterns to confirm `/matches` doesn't conflict
- [ ] Check AppShell nav component location and how to add a new nav item
- [ ] Confirm `LazyImage` component props signature
- [ ] Verify `VarietyPicker` works with `plantId` as a slug string (it uses slug for the API call)
- [ ] Decide: show unmatched images (no plant inference) in UI? Proposal: no — separate workflow
- [ ] Consider: "approve all in folder" bulk action (nice-to-have, not MVP)

---

## Risk Assessment

- **VarietyPicker plant change**: When user overrides plant, VarietyPicker must reset. This is handled by the `currentVariety` prop sync in VarietyPicker — just pass `null` when plant changes.
- **Keyboard conflicts with autocomplete**: PlantAutocomplete and VarietyPicker have their own key handlers. The global `a`/`r`/`i` hotkeys must check `document.activeElement` to suppress when inside inputs — critical to get right.
- **Large groups**: If a folder has 200+ images, virtual scrolling might be needed. Start without it; add if performance is a problem.
- **File already gone**: Between page load and approve action, file may have been processed externally. API returns 404 → show "already processed" toast, remove from UI.

---

## Success Criteria

- Page loads and shows grouped matches with thumbnails visible
- Keyboard `a` on a card calls approve API, card disappears from list with green flash
- Keyboard `Ctrl+Z` restores last approved card to the list
- Plant override via PlantAutocomplete updates the VarietyPicker to show that plant's varieties
- No keyboard event leaks into autocomplete inputs (typing "a" in plant field doesn't trigger approve)
- Progress bar advances as items are actioned
