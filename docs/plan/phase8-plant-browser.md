# Phase 8: Plant Database Browser & Editor UI

## Goal

Build an internal web UI for HTFG staff to browse, search, review, and edit the complete plant database stored in NocoDB. Extends the existing Phase 5 Review UI application.

## Decisions

- **Audience:** Internal staff only
- **Architecture:** Extend existing Review UI (shared auth, image serving, Docker deployment)
- **Data source:** NocoDB REST API proxied through Express (full CRUD)
- **Editing permissions:** Admin role only (viewers can browse + add notes)
- **Content folder:** Single Docker volume mount of `content/parsed/` (contains `plants/{id}/images/`)
- **Search:** Full-text across all content (plants, varieties, documents, recipes, OCR text)
- **Notes:** Per-plant and/or per-variety
- **Export:** Deferred to v2

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + ShadCN + Tailwind |
| Data fetching | @tanstack/react-query |
| Routing | react-router-dom v7 |
| Backend | Express (existing server) |
| Data source | NocoDB REST API (proxied) |
| Image serving | Express static (existing `IMAGE_MOUNT_PATH`) |
| Auth | Existing magic-link + session cookies |
| Notes storage | Local SQLite (not NocoDB — fast for frequent small writes) |

## Screens

### Plant Grid (`/plants`)
- Responsive card grid (2 cols mobile, 3 tablet, 4-5 desktop)
- Each card: hero image, plant name, botanical name, category badge, image count, variety count
- Search bar (full-text across plant names, botanical names, aliases, documents, recipes, OCR)
- Category filter dropdown, sort dropdown (name A-Z, image count)
- Pagination

### Plant Detail (`/plants/:id`)
Tabbed interface:

| Tab | Content | Editable (admin) |
|-----|---------|-------------------|
| Overview | Hero image, name, botanical name, aliases, harvest calendar, description | Yes — name, botanical, aliases, description |
| Gallery | Paginated image grid with lightbox (50/page for large sets) | v2 |
| Varieties | Table with name, characteristics, tasting notes | Yes — inline CRUD |
| Nutrition | Table with nutrient, value, unit, per serving | Yes — inline CRUD |
| Documents | Expandable list with title, type, content preview | Read-only |
| Recipes | Recipe cards with ingredients/method | Read-only |
| OCR | Extraction list with source image side-by-side | Read-only |
| Notes | Comment thread per plant/variety | Yes — all auth'd users |
| Growing/Pests | Placeholder for future content | v2 |

### Edit Mode
- Toggle button in header (admin only)
- Fields become editable inputs
- Save/Cancel buttons
- Confirmation dialogs for destructive actions

## Architecture

```
Browser → Express Server → NocoDB API (https://nocodb.djjd.us)
                ↓
          Local SQLite (staff_notes table)
                ↓
          Static files (content/parsed/ via IMAGE_MOUNT_PATH)
```

## Task List

### 8A: Backend — NocoDB Proxy + Notes

| # | Task | Depends |
|---|------|---------|
| 1 | NocoDB API client (`server/lib/nocodb.ts`) — fetch wrapper with token, base URL, table ID lookup | — |
| 2 | Plant list endpoint — search, filter, pagination, image count | 1 |
| 3 | Plant detail endpoint — aggregate all related tables for one plant | 1 |
| 4 | Plant update endpoint — PATCH core fields via NocoDB | 1 |
| 5 | Varieties CRUD endpoints | 1 |
| 6 | Nutritional info CRUD endpoints | 1 |
| 7 | Full-text search endpoint — searches across Plants, Documents, Recipes, OCR, Varieties | 1 |
| 8 | Staff notes — SQLite table + CRUD endpoints (per-plant, per-variety) | — |
| 9 | Mount routes in server/index.ts | 2-8 |

### 8B: Frontend — Plant Grid

| # | Task | Depends |
|---|------|---------|
| 10 | Install @tanstack/react-query, set up QueryClientProvider | — |
| 11 | PlantGridPage — responsive card grid | 9 |
| 12 | PlantCard component — thumbnail, name, stats | 11 |
| 13 | Search bar with debounced full-text input | 11 |
| 14 | Category filter + sort controls | 11 |
| 15 | Route `/plants` + nav link in BottomNav/header | 11 |

### 8C: Frontend — Plant Detail

| # | Task | Depends |
|---|------|---------|
| 16 | PlantDetailPage — header + tab container | 9 |
| 17 | Overview tab — hero image, metadata, harvest calendar | 16 |
| 18 | Gallery tab — thumbnail grid, lightbox, pagination | 16 |
| 19 | Varieties tab — data table | 16 |
| 20 | Nutrition tab — data table | 16 |
| 21 | Documents tab — expandable list | 16 |
| 22 | Recipes tab — recipe cards | 16 |
| 23 | OCR tab — extraction list with image preview | 16 |
| 24 | Notes tab — comment thread | 8, 16 |
| 25 | Route `/plants/:id` | 16 |

### 8D: Edit Mode

| # | Task | Depends |
|---|------|---------|
| 26 | Edit mode toggle (admin only) | 16 |
| 27 | Editable overview fields (react-hook-form) | 26, 4 |
| 28 | Varieties inline CRUD | 26, 5 |
| 29 | Nutritional info inline CRUD | 26, 6 |

### 8E: Polish

| # | Task | Depends |
|---|------|---------|
| 30 | Responsive layout fixes | 8B, 8C |
| 31 | Loading/error/empty states | 8C |
| 32 | Navigation redesign — unified nav | 15 |

## Docker Volume

```yaml
volumes:
  - ./content/parsed:/data/images:ro    # existing mount, serves plant images
```

The `content/parsed/plants/{id}/images/` directories contain the organized plant photos. No other folders need migration — all structured data is in NocoDB.

## v1 vs v2

| Feature | v1 | v2 |
|---------|-----|-----|
| Plant gallery + search | ✓ | Enhanced filters |
| Plant detail (all tabs) | ✓ read-only | Full CRUD all tabs |
| Edit plant core fields | ✓ admin | All users with roles |
| Edit varieties/nutrition | ✓ admin | + bulk operations |
| Staff notes | ✓ all users | Threaded, @mentions |
| Image management | — | Reassign, remove, bulk |
| Export | — | CSV, PDF plant cards |
| Activity log | — | Who edited what, when |
| Harvest calendar page | — | Cross-plant monthly view |
