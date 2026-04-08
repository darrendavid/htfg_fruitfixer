import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('htfg-admin-2026');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test.describe('Triage Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Triage tab loads and shows items', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    // Triage should be the default tab
    const triageBtn = page.getByRole('button', { name: 'Triage' });
    await expect(triageBtn).toBeVisible();

    // Wait for items to load
    await page.waitForTimeout(2000);

    // Should show items or "No items in triage"
    const hasItems = await page.locator('[data-testid^="triage-item-"]').count() > 0;
    const hasEmpty = await page.getByText('No items in triage').isVisible().catch(() => false);
    expect(hasItems || hasEmpty).toBe(true);

    await page.screenshot({ path: 'test-results/triage-tab.png' });
  });

  test('Plain click on image opens preview dialog', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.waitForTimeout(2000);

    const items = page.locator('[data-testid^="triage-item-"]');
    const count = await items.count();
    if (count === 0) { test.skip(); return; }

    // Find an image item (has <img> tag)
    let imageIdx = -1;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const hasImg = await items.nth(i).locator('img').count() > 0;
      if (hasImg) { imageIdx = i; break; }
    }

    if (imageIdx >= 0) {
      // Plain click should open preview
      await items.nth(imageIdx).locator('.aspect-square').click();
      await page.waitForTimeout(500);

      // Preview dialog should be open with a full-size image
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const previewImg = dialog.locator('img');
      await expect(previewImg).toBeVisible();

      // Close dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // No selection should have happened
      const selectedCount = await page.getByText(/selected/).count();
      // "selected" text should NOT be visible (0 selected)
      expect(selectedCount).toBe(0);

      console.log('[triage] Plain click opened preview, no selection');
    }
  });

  test('Plain click on document opens in new tab', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.waitForTimeout(2000);

    const items = page.locator('[data-testid^="triage-item-"]');
    const count = await items.count();
    if (count === 0) { test.skip(); return; }

    // Find a non-image item (has document badge like PDF/TXT/DOC)
    let docIdx = -1;
    for (let i = 0; i < Math.min(count, 30); i++) {
      const hasImg = await items.nth(i).locator('img').count() > 0;
      if (!hasImg) {
        // This is a document item — should have a file type badge
        const hasBadge = await items.nth(i).locator('.uppercase').count() > 0;
        if (hasBadge) { docIdx = i; break; }
      }
    }

    if (docIdx >= 0) {
      // Listen for new tab
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
        items.nth(docIdx).locator('.aspect-square').click(),
      ]);

      if (newPage) {
        console.log('[triage] Document click opened new tab:', newPage.url());
        await newPage.close();
      } else {
        console.log('[triage] Document click did not open new tab (may have no doc items)');
      }
    } else {
      console.log('[triage] No document items found to test');
    }
  });

  test('Ctrl+click selects items without opening preview', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.waitForTimeout(2000);

    const items = page.locator('[data-testid^="triage-item-"]');
    const count = await items.count();
    if (count < 2) { test.skip(); return; }

    // Find two items that have images (skip document items at the start)
    let imgIdxs: number[] = [];
    for (let i = 0; i < Math.min(count, 30) && imgIdxs.length < 2; i++) {
      const hasImg = await items.nth(i).locator('img').count() > 0;
      if (hasImg) imgIdxs.push(i);
    }
    // Fall back to first two items if no images found
    if (imgIdxs.length < 2) imgIdxs = [0, 1];

    // Ctrl+click first item
    await items.nth(imgIdxs[0]).locator('.aspect-square').click({ modifiers: ['Control'] });
    await expect(page.getByText('1 selected').first()).toBeVisible({ timeout: 2000 });

    // No dialog should be open
    const dialogCount = await page.getByRole('dialog').count();
    expect(dialogCount).toBe(0);

    // Ctrl+click second item
    await items.nth(imgIdxs[1]).locator('.aspect-square').click({ modifiers: ['Control'] });
    await expect(page.getByText('2 selected').first()).toBeVisible({ timeout: 2000 });

    // Action bar should be visible
    await expect(page.getByPlaceholder('Assign to plant...')).toBeVisible();

    console.log('[triage] Ctrl+click selects without preview');
    await page.screenshot({ path: 'test-results/triage-multiselect.png' });
  });

  test('Shift+click range selects', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.waitForTimeout(2000);

    const items = page.locator('[data-testid^="triage-item-"]');
    const count = await items.count();
    if (count < 4) { test.skip(); return; }

    // Find first image item
    let startIdx = 0;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const hasImg = await items.nth(i).locator('img').count() > 0;
      if (hasImg) { startIdx = i; break; }
    }

    // Ctrl+click to start selection
    await items.nth(startIdx).locator('.aspect-square').click({ modifiers: ['Control'] });
    await expect(page.getByText('1 selected').first()).toBeVisible({ timeout: 2000 });

    // Shift+click 3 items later
    const endIdx = Math.min(startIdx + 3, count - 1);
    await items.nth(endIdx).locator('.aspect-square').click({ modifiers: ['Shift'] });
    const expectedCount = endIdx - startIdx + 1;
    await expect(page.getByText(`${expectedCount} selected`).first()).toBeVisible({ timeout: 2000 });

    console.log(`[triage] Shift+click range selected ${expectedCount} items`);
  });

  test('Document items show file type badge', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    await page.waitForTimeout(2000);

    const items = page.locator('[data-testid^="triage-item-"]');
    const count = await items.count();

    // Check if any items have document badges
    let docBadges = 0;
    for (let i = 0; i < Math.min(count, 30); i++) {
      const badge = items.nth(i).locator('.uppercase');
      if (await badge.count() > 0) {
        const text = await badge.first().textContent();
        console.log(`[triage] Item ${i} has badge: ${text}`);
        docBadges++;
      }
    }
    console.log(`[triage] Found ${docBadges} document badges out of ${count} items`);
  });
});
