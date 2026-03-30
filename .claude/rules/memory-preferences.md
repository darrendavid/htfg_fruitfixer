---
name: User Preferences
description: How Darren likes to work and what to avoid
type: feedback
---

## Development Workflow
- **MUST test Gallery loads after every GalleryTab.tsx change** — this component is fragile due to React hooks ordering. Verify via Playwright or manual check before committing.
- **Run `npx vite build` after frontend changes** — catches OXC/JSX parse errors that vitest/esbuild misses
- **Run tests before committing** — `npx vitest run` (254 tests across 6 files)
- **Restart server after backend route changes** — tsx watch doesn't always pick up new routes
- **Use `Bash(*)` permission** — settings.local.json allows all bash commands, no need to ask
- **Desktop scaling is 225%** — all UI must handle high-DPI correctly (use dvh/dvw not vh/vw, test at scaled resolutions)
- **Accesses dev server over VPN** at 10.0.1.45:5173 — Vite proxy forwards /api to localhost:3001

## UI/UX Preferences
- No confirmation dialogs for delete — just delete and allow undo/restore
- Autocomplete dropdowns should open upward (avoid dialog/viewport clipping)
- Input fields on dark backgrounds need white/light background for visibility
- Text on colored backgrounds must have sufficient contrast
- Image dialog should not require scrolling to see action buttons
- Hero images marked with gold star in both grid and lightbox
- Resolution overlay (pixel dimensions + file size) on all gallery view modes
- Grid state (page, scroll, filters) must persist across detail page navigation
- Scroll to top when changing pages, restore position when returning from detail
- **Prefer foreign keys over denormalized strings** — user explicitly called out Variety_Name fragility and requested FK refactor

## Hotkeys (Gallery Lightbox)
- Arrow keys: navigate images
- h: set hero image
- x: delete/hide image
- a: move to attachments
- [/]: rotate left/right
- v: focus variety field
- p: focus plant field
- r: replace image
- Esc: close lightbox
- Suppress hotkeys when focus is in INPUT/TEXTAREA

## Hotkeys (Match Review)
- a: approve, r: triage, i: ignore
- j/ArrowDown: next card, k/ArrowUp: previous card
- Ctrl+Z: undo last action

## Architecture Preferences
- New plant creation should be available from any reassignment autocomplete field
- Multi-select: ctrl+click individual, shift+click range, selection bar with delete + move-to
- Documents/Attachments should have download, delete, and plant reassignment capabilities
- **Phase 4C inference should use live NocoDB data**, not CSV files or static JSON registries
- Reports (like duplicate verification) as static HTML with thumbnails, filtering, and lightbox
