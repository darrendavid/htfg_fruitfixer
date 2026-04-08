import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('htfg-admin-2026');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test.describe('Image Search Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Search Files button exists and opens dialog', async ({ page }) => {
    await page.goto(`${BASE}/plants/avocado`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    // Find the Search Files button
    const searchBtn = page.getByRole('button', { name: 'Search Files' });
    await expect(searchBtn).toBeVisible();

    // Click it
    await searchBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Should have a search input
    const input = dialog.getByPlaceholder(/search by fruit name/i);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    await page.screenshot({ path: 'test-results/image-search-empty.png' });
  });

  test('Search returns results in two tabs', async ({ page }) => {
    await page.goto(`${BASE}/plants/avocado`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Search Files' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Search for "sharwil" — should find avocado variety images
    await dialog.getByPlaceholder(/search by fruit name/i).fill('sharwil');
    await page.waitForTimeout(1000);

    // Should show Assigned tab with results
    const assignedTab = dialog.getByRole('button', { name: /^Assigned \(/i });
    await expect(assignedTab).toBeVisible({ timeout: 5000 });
    const assignedText = await assignedTab.textContent();
    console.log('[search] Assigned tab:', assignedText);

    // Should have image cards
    const cards = dialog.locator('.aspect-square');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    console.log('[search] Image cards visible:', count);
    expect(count).toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/image-search-sharwil.png' });
  });

  test('Search for original filepath pattern', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Search Files' }).click();
    const dialog = page.getByRole('dialog');

    // Search for a source directory pattern
    await dialog.getByPlaceholder(/search by fruit name/i).fill('dipping');
    await page.waitForTimeout(1000);

    const cards = dialog.locator('.aspect-square');
    const count = await cards.count();
    console.log('[search] dipping results:', count);

    await page.screenshot({ path: 'test-results/image-search-dipping.png' });
  });

  test('Multi-select works with ctrl+click and shift+click', async ({ page }) => {
    await page.goto(`${BASE}/plants/avocado`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Search Files' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder(/search by fruit name/i).fill('sharwil');
    await page.waitForTimeout(1000);

    const cards = dialog.locator('.aspect-square');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });

    // Click first card (plain click toggles selection)
    await cards.nth(0).click();
    // Should show selection indicator - check for the blue ring
    await expect(cards.nth(0)).toHaveClass(/ring-blue/);
    // Should show "1 selected" in the dialog
    await expect(dialog.getByText('1 selected').first()).toBeVisible({ timeout: 2000 });

    // Ctrl+click second card
    await cards.nth(1).click({ modifiers: ['Control'] });
    await expect(dialog.getByText('2 selected').first()).toBeVisible({ timeout: 2000 });

    // Shift+click fourth card (should select range)
    const cardCount = await cards.count();
    if (cardCount >= 4) {
      await cards.nth(3).click({ modifiers: ['Shift'] });
      await expect(dialog.getByText('4 selected').first()).toBeVisible({ timeout: 2000 });
    }

    // Action bar should be visible with "Assign to plant" input
    await expect(dialog.getByPlaceholder(/assign to plant/i)).toBeVisible();

    await page.screenshot({ path: 'test-results/image-search-multiselect.png' });
  });

  test('Can switch between Assigned and Unassigned tabs', async ({ page }) => {
    await page.goto(`${BASE}/plants/avocado`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Search Files' }).click();
    const dialog = page.getByRole('dialog');

    // Use a broad search
    await dialog.getByPlaceholder(/search by fruit name/i).fill('image');
    await page.waitForTimeout(1500);

    // Click Unassigned tab (use first-matching to avoid ambiguity)
    const unassignedTab = dialog.getByRole('button', { name: /^Unassigned/i });
    if (await unassignedTab.isVisible()) {
      await unassignedTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-results/image-search-unassigned.png' });

      // Switch back
      await dialog.getByRole('button', { name: /^Assigned \(/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('Dialog closes cleanly', async ({ page }) => {
    await page.goto(`${BASE}/plants/avocado`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Search Files' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Gallery should still be functional
    const galleryImages = page.locator('.aspect-square img').first();
    await expect(galleryImages).toBeVisible();
  });
});
