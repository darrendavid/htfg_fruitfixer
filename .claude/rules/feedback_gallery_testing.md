---
name: Always test Gallery after changes
description: Gallery tab is fragile — must verify it loads and functions after every modification to GalleryTab.tsx or related files
type: feedback
---

After ANY change to GalleryTab.tsx, browse.ts, or related gallery/browse code:
1. Run `npx vitest run` (backend tests)
2. Run `npx vite build 2>&1 | tail -5` to catch OXC/JSX parse errors that vitest/esbuild misses
3. Restart the server (tsx) and Vite
4. Navigate to a plant with images (e.g. /plants/banana)
5. Click the Gallery tab and verify it renders
6. Test lightbox opens on click, arrow navigation works
7. Test grouped views (variety, similarity, directory) render

**Why:** Two classes of bugs repeatedly crash the Gallery:
1. **React hooks ordering** — useCallback/useMemo/useEffect placed after early returns causes "Rendered more hooks than during the previous render". Not caught by backend tests.
2. **JSX syntax errors** — Vitest uses esbuild which is more lenient than Vite's OXC transform. Missing fragment wrappers (`<>...</>`) around multiple elements in ternaries pass vitest but crash Vite dev server. Must run `npx vite build` as a compile check.

**How to apply:** Before telling the user a gallery change is complete, always:
- Run `npx vite build` to catch OXC parse errors
- Verify the Gallery tab loads in the browser via Playwright or manual check
- Never commit frontend changes that haven't been build-checked
