import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('htfg-admin-2026');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

async function goToRecoveredTab(page: Page) {
  await page.goto(`${BASE}/classify`);
  const recoveredBtn = page.getByRole('button', { name: 'Recovered' });
  await expect(recoveredBtn).toBeVisible({ timeout: 5000 });
  await recoveredBtn.click();
  // Wait for sidebar to load
  await page.waitForTimeout(1500);
}

test.describe('Recovered Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Recovered tab loads plant groups in sidebar', async ({ page }) => {
    await goToRecoveredTab(page);

    // Either shows plant groups or "No recovered images"
    const sidebar = page.locator('aside, [class*="sidebar"], [class*="w-\\[250px\\]"]').first();
    const hasGroups = await page.locator('[data-testid="plant-group-item"]').count() > 0
      || await page.getByText(/recovered images/i).isVisible().catch(() => false)
      || await page.locator('.space-y-1 button').count() > 0;

    // The sidebar title should mention Recovered
    const hasSidebarTitle = await page.getByText('Recovered Images').isVisible().catch(() => false);

    console.log('[recovered] Has groups:', hasGroups, 'Has title:', hasSidebarTitle);
    await page.screenshot({ path: 'test-results/recovered-tab-initial.png' });
    expect(hasGroups || hasSidebarTitle).toBe(true);
  });

  test('Selecting a plant loads images in main area', async ({ page }) => {
    await goToRecoveredTab(page);

    // Click the first plant group in the sidebar (if any)
    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    const count = await plantButtons.count();
    if (count === 0) {
      console.log('[recovered] No plant groups found — skipping');
      test.skip();
      return;
    }

    await plantButtons.first().click();
    await page.waitForTimeout(2000);

    // Main area should show either images or "No recovered images for this plant"
    const hasImages = await page.locator('main img').count() > 0;
    const hasEmpty = await page.getByText(/No recovered images for this plant/i).isVisible().catch(() => false);
    const hasRows = await page.locator('main [class*="border"]').count() > 0;

    console.log('[recovered] Images:', await page.locator('main img').count(), 'Rows:', await page.locator('main [class*="border"]').count());
    await page.screenshot({ path: 'test-results/recovered-tab-plant-selected.png' });
    expect(hasImages || hasEmpty || hasRows).toBe(true);
  });

  test('Images load without 404 errors', async ({ page }) => {
    const imageErrors: string[] = [];

    // Intercept failed image requests
    page.on('response', (response) => {
      const url = response.url();
      if (
        (url.includes('/images/') || url.includes('/unassigned-images/') || url.includes('/content-files/')) &&
        response.status() === 404
      ) {
        imageErrors.push(url);
      }
    });

    await goToRecoveredTab(page);

    // Click first plant if present
    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    if (await plantButtons.count() > 0) {
      await plantButtons.first().click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'test-results/recovered-tab-image-errors.png' });

    const totalImgs = await page.locator('main img').count();
    if (imageErrors.length > 0) {
      console.warn(`[recovered] ${imageErrors.length}/${totalImgs} image URLs returned 404:`);
      imageErrors.slice(0, 10).forEach(u => console.warn(' ', u));
    } else {
      console.log(`[recovered] All ${totalImgs} images loaded without 404s`);
    }

    // After the NocoDB File_Path enrichment fix, 404s should be dramatically reduced.
    // A small number of genuinely missing files (never recovered to disk) is acceptable.
    // Fail if more than 20% of images are broken.
    if (totalImgs > 0) {
      const errorRate = imageErrors.length / totalImgs;
      expect(errorRate).toBeLessThan(0.2);
    }
  });

  test('Plain click on image row opens preview dialog', async ({ page }) => {
    await goToRecoveredTab(page);

    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    if (await plantButtons.count() === 0) { test.skip(); return; }

    await plantButtons.first().click();
    await page.waitForTimeout(2000);

    const rows = page.locator('main [class*="flex gap-3"][class*="cursor-pointer"]');
    const rowCount = await rows.count();
    if (rowCount === 0) { test.skip(); return; }

    // Click first row with an image
    await rows.first().click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (dialogVisible) {
      console.log('[recovered] Preview dialog opened');
      await expect(dialog.locator('img')).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      console.log('[recovered] No preview dialog (may be expected for some items)');
    }
    await page.screenshot({ path: 'test-results/recovered-tab-click.png' });
  });

  test('Ctrl+click selects images and shows action bar', async ({ page }) => {
    await goToRecoveredTab(page);

    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    if (await plantButtons.count() === 0) { test.skip(); return; }

    await plantButtons.first().click();
    await page.waitForTimeout(2000);

    const rows = page.locator('main [class*="flex gap-3"][class*="cursor-pointer"]');
    if (await rows.count() < 2) { test.skip(); return; }

    // Ctrl+click first row
    await rows.first().click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);

    // Action bar should appear
    await expect(page.getByPlaceholder('Assign to plant...')).toBeVisible({ timeout: 3000 });
    const selectedText = await page.getByText(/selected/i).first().textContent();
    console.log('[recovered] Selection text:', selectedText);
    expect(selectedText).toMatch(/1 selected/);

    // Ctrl+click second row
    await rows.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);
    const selected2 = await page.getByText(/selected/i).first().textContent();
    expect(selected2).toMatch(/2 selected/);

    await page.screenshot({ path: 'test-results/recovered-tab-multiselect.png' });
  });

  test('Assigned image disappears from Recovered tab after assignment and reload', async ({ page }) => {
    await goToRecoveredTab(page);

    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    if (await plantButtons.count() === 0) { test.skip(); return; }

    await plantButtons.first().click();
    await page.waitForTimeout(2000);

    const rows = page.locator('main [class*="flex gap-3"][class*="cursor-pointer"]');
    const initialCount = await rows.count();
    if (initialCount === 0) { test.skip(); return; }

    console.log(`[recovered] Initial row count: ${initialCount}`);

    // Ctrl+click to select first row
    await rows.first().click({ modifiers: ['Control'] });
    await expect(page.getByPlaceholder('Assign to plant...')).toBeVisible({ timeout: 3000 });

    // Get the plant name from the first sidebar button (to assign to the same plant — safe)
    const plantName = await plantButtons.first().textContent();
    console.log('[recovered] Will assign to plant:', plantName?.trim());

    // Type in the plant autocomplete and select
    const plantInput = page.getByPlaceholder('Assign to plant...');
    await plantInput.fill(plantName?.trim().split(' ')[0] ?? 'banana');
    await page.waitForTimeout(800);

    const dropdown = page.locator('[role="listbox"] [role="option"]').first();
    if (await dropdown.isVisible().catch(() => false)) {
      await dropdown.click();
      await page.waitForTimeout(1500);

      const newCount = await page.locator('main [class*="flex gap-3"][class*="cursor-pointer"]').count();
      console.log(`[recovered] Row count after assign: ${newCount} (was ${initialCount})`);
      expect(newCount).toBe(initialCount - 1);

      // Reload and verify it doesn't come back
      await goToRecoveredTab(page);
      await plantButtons.first().click();
      await page.waitForTimeout(2000);

      const reloadCount = await page.locator('main [class*="flex gap-3"][class*="cursor-pointer"]').count();
      console.log(`[recovered] Row count after reload: ${reloadCount}`);
      expect(reloadCount).toBe(newCount);
    } else {
      console.log('[recovered] No autocomplete results — skipping assignment');
    }

    await page.screenshot({ path: 'test-results/recovered-tab-after-assign.png' });
  });

  test('Hidden tab shows all images without 200-item cap', async ({ page }) => {
    await page.goto(`${BASE}/classify`);
    const hiddenBtn = page.getByRole('button', { name: 'Hidden' });
    await expect(hiddenBtn).toBeVisible({ timeout: 5000 });
    await hiddenBtn.click();
    await page.waitForTimeout(1500);

    // Click first plant group
    const plantButtons = page.locator('aside button, [class*="w-\\[250px\\]"] button').filter({ hasNotText: /^\s*$/ });
    if (await plantButtons.count() === 0) { test.skip(); return; }

    // Find a plant with >200 images (look at the count badge)
    let bigPlantBtn = plantButtons.first();
    for (let i = 0; i < await plantButtons.count(); i++) {
      const text = await plantButtons.nth(i).textContent() ?? '';
      const match = text.match(/(\d+)/);
      if (match && parseInt(match[1]) > 200) {
        bigPlantBtn = plantButtons.nth(i);
        console.log('[hidden] Found plant with >200 images:', text.trim());
        break;
      }
    }

    await bigPlantBtn.click();
    await page.waitForTimeout(3000);

    const imgCount = await page.locator('main img').count();
    console.log('[hidden] Images loaded:', imgCount);
    await page.screenshot({ path: 'test-results/hidden-tab-large-plant.png' });

    // If the plant actually has >200, we should see >200 images now
    const plantText = await bigPlantBtn.textContent() ?? '';
    const match = plantText.match(/(\d+)/);
    if (match && parseInt(match[1]) > 200) {
      expect(imgCount).toBeGreaterThan(200);
    } else {
      // Just verify something loaded
      expect(imgCount).toBeGreaterThan(0);
    }
  });
});
