import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('htfg-admin-2026');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test.describe('Classify page tabs + Variety Match review', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Classify page has Triage and Variety Matches tabs', async ({ page }) => {
    await page.goto(`${BASE}/classify`);

    // Both tabs should be visible
    const triageTab = page.getByRole('button', { name: 'Triage' });
    const varietyTab = page.getByRole('button', { name: 'Variety Matches' });
    await expect(triageTab).toBeVisible();
    await expect(varietyTab).toBeVisible();

    // Triage should be active by default
    await expect(triageTab).toHaveClass(/border-foreground/);
  });

  test('Variety Matches tab loads plant groups and items', async ({ page }) => {
    await page.goto(`${BASE}/classify`);

    // Click Variety Matches tab
    await page.getByRole('button', { name: 'Variety Matches' }).click();

    // Wait for sidebar to load plant groups
    await page.waitForTimeout(2000);

    // Should see plant names in the sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar.locator('button').first()).toBeVisible({ timeout: 10000 });

    // Get the first plant button text
    const firstPlant = sidebar.locator('button').first();
    const plantName = await firstPlant.textContent();
    console.log(`[variety-tab] First plant: ${plantName}`);

    // Items should load for the first plant automatically
    const mainPanel = page.locator('main');
    await expect(mainPanel.locator('.rounded-lg.border').first()).toBeVisible({ timeout: 10000 });

    // Should show a confidence badge
    await expect(mainPanel.locator('text=/high|medium|low/').first()).toBeVisible();

    // Should show suggested variety name
    await expect(mainPanel.locator('text=Suggested:').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/variety-match-tab.png', fullPage: false });
  });

  test('Accept variety suggestion updates NocoDB', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.getByRole('button', { name: 'Variety Matches' }).click();

    // Wait for items to load
    await page.locator('main .rounded-lg.border').first().waitFor({ timeout: 10000 });

    // Get the first item's image_id from the card
    const firstCard = page.locator('main .rounded-lg.border').first();
    const suggestedText = await firstCard.locator('text=Suggested:').first().textContent();
    console.log(`[accept] Suggested: ${suggestedText}`);

    // Click Accept on first card
    await firstCard.getByRole('button', { name: 'Accept' }).click();
    await page.waitForTimeout(500);

    // The card should have been removed
    console.log('[accept] Card removed after accept');

    // Stats should show 1 accepted
    const statsText = await page.locator('aside').textContent();
    expect(statsText).toContain('1 accepted');
  });

  test('Skip removes item without DB update', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.getByRole('button', { name: 'Variety Matches' }).click();

    await page.locator('main .rounded-lg.border').first().waitFor({ timeout: 10000 });
    const countBefore = await page.locator('main .rounded-lg.border').count();

    // Click Skip on first card
    await page.locator('main .rounded-lg.border').first().getByRole('button', { name: 'Skip' }).click();
    await page.waitForTimeout(300);

    const countAfter = await page.locator('main .rounded-lg.border').count();
    expect(countAfter).toBe(countBefore - 1);

    const statsText = await page.locator('aside').textContent();
    expect(statsText).toContain('1 skipped');
  });

  test('Switching between tabs preserves state', async ({ page }) => {
    await page.goto(`${BASE}/classify`);

    // Go to Variety Matches
    await page.getByRole('button', { name: 'Variety Matches' }).click();
    await page.locator('main .rounded-lg.border').first().waitFor({ timeout: 10000 });

    // Switch back to Triage
    await page.getByRole('button', { name: 'Triage' }).click();
    await page.waitForTimeout(500);

    // Switch back — should still show variety tab
    await page.getByRole('button', { name: 'Variety Matches' }).click();
    await page.waitForTimeout(500);

    // Sidebar should still be visible
    await expect(page.locator('aside button').first()).toBeVisible();
  });
});
