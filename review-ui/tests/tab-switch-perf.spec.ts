import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('htfg-admin-2026');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test('Tab switching on Avocado should be fast (no re-fetch)', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/plants/avocado`);

  // Wait for Gallery tab to be visible — page loaded
  await page.getByRole('tab', { name: 'Gallery' }).waitFor({ timeout: 15000 });

  // Step 1: Click Gallery, wait for images to load
  await page.getByRole('tab', { name: 'Gallery' }).click();
  // Wait for at least one image thumbnail to render
  await page.locator('.aspect-square img').first().waitFor({ timeout: 15000 });
  console.log('[1] Gallery loaded with images');

  // Step 2: Switch to Varieties
  await page.getByRole('tab', { name: 'Varieties' }).click();
  // Wait for variety content to be visible
  await page.getByPlaceholder('Filter varieties...').waitFor({ timeout: 10000 });
  console.log('[2] Varieties tab loaded');

  // Step 3: Switch back to Gallery — should be instant (no re-fetch)
  const t0 = Date.now();
  await page.getByRole('tab', { name: 'Gallery' }).click();

  // The gallery images should already be in the DOM (force-mounted)
  // Just need to verify they're visible
  await page.locator('.aspect-square img').first().waitFor({ state: 'visible', timeout: 3000 });
  const elapsed = Date.now() - t0;
  console.log(`[3] Gallery re-shown in ${elapsed}ms`);

  // Must be under 2 seconds (was 10+ before fix)
  expect(elapsed).toBeLessThan(2000);

  // Step 4: Verify no console errors (hooks ordering)
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Switch a few more times to trigger any hook issues
  await page.getByRole('tab', { name: 'Varieties' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('tab', { name: 'Gallery' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('tab', { name: 'Gallery' }).click();
  await page.waitForTimeout(500);

  expect(errors.filter(e => e.includes('hooks') || e.includes('Rendered more hooks'))).toHaveLength(0);
  console.log('[4] No hook errors after rapid tab switching');
});

test('Gallery tab does not re-fetch when switching back (network check)', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/plants/avocado`);
  await page.getByRole('tab', { name: 'Gallery' }).waitFor({ timeout: 15000 });

  // Load Gallery first
  await page.getByRole('tab', { name: 'Gallery' }).click();
  await page.locator('.aspect-square img').first().waitFor({ timeout: 15000 });

  // Switch to Varieties
  await page.getByRole('tab', { name: 'Varieties' }).click();
  await page.getByPlaceholder('Filter varieties...').waitFor({ timeout: 10000 });

  // Start monitoring API calls
  const apiCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/browse/') && req.url().includes('images')) {
      apiCalls.push(req.url());
    }
  });

  // Switch back to Gallery
  await page.getByRole('tab', { name: 'Gallery' }).click();
  await page.waitForTimeout(1000);

  console.log(`[network] API image calls after switch-back: ${apiCalls.length}`);
  // Should be 0 — data was kept in DOM via forceMount
  expect(apiCalls.length).toBe(0);
});
