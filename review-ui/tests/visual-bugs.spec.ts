import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'htfg-admin-2026';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test.describe('Visual bug fixes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Plants search row is sticky with no gap to header', async ({ page }) => {
    await page.goto(`${BASE}/plants`);
    // Wait for the view toggle to verify page loaded
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });

    // Scroll down to trigger sticky behavior
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(300);

    // Get bounding boxes of header and search row
    const header = await page.locator('header').boundingBox();
    const searchRow = await page.locator('.sticky.top-14').first().boundingBox();
    expect(header).toBeTruthy();
    expect(searchRow).toBeTruthy();

    // Search row top should equal header bottom (no gap)
    const headerBottom = header!.y + header!.height;
    expect(Math.abs(searchRow!.y - headerBottom)).toBeLessThanOrEqual(1);
    console.log(`[plants] header bottom: ${headerBottom}, search row top: ${searchRow!.y}, gap: ${searchRow!.y - headerBottom}px`);

    await page.screenshot({ path: 'test-results/plants-sticky-search.png', fullPage: false });
  });

  test('Varieties tab action bar has no gap to tabs', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Overview' }).waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.getByTestId('view-toggle-list').waitFor({ timeout: 10000 });

    // Scroll down so sticky bars are engaged
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);

    // Get bounds of tabs container and action bar
    const tabsWrap = page.locator('.sticky.top-14').first();
    // Find the action bar by walking up from the filter input
    const filterInput = page.getByPlaceholder('Filter varieties...');
    await filterInput.waitFor({ timeout: 5000 });
    const actionBar = filterInput.locator('xpath=ancestor::div[contains(@class,"sticky")][1]');

    const tabsBox = await tabsWrap.boundingBox();
    const actionBox = await actionBar.boundingBox();
    expect(tabsBox).toBeTruthy();
    expect(actionBox).toBeTruthy();

    const tabsBottom = tabsBox!.y + tabsBox!.height;
    const gap = actionBox!.y - tabsBottom;
    console.log(`[varieties] tabs bottom: ${tabsBottom}, action bar top: ${actionBox!.y}, gap: ${gap}px`);
    // Allow 1px rounding tolerance
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'test-results/varieties-sticky-gap.png', fullPage: false });
  });

  test('Variety detail dialog: photos scale correctly inside dialog bounds', async ({ page }) => {
    // Test with a variety that has images — try banana 'Maoli Haikea' or first one
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.getByTestId('view-toggle-list').waitFor({ timeout: 10000 });

    // Open first variety that has a photo
    // Let's click several candidates until we find one with photos
    const links = page.locator('[data-testid^="variety-name-link-"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    let foundWithPhotos = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      await links.nth(i).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Wait a moment for images to load
      await page.waitForTimeout(500);
      const slider = dialog.getByTestId('variety-photo-slider');
      const hasSlider = await slider.count() > 0;
      if (hasSlider) {
        foundWithPhotos = true;

        // Get dialog and image bounds
        const dialogBox = await dialog.boundingBox();
        const sliderBox = await slider.boundingBox();
        const img = slider.locator('img').first();
        const imgBox = await img.boundingBox();

        expect(dialogBox).toBeTruthy();
        expect(sliderBox).toBeTruthy();
        expect(imgBox).toBeTruthy();

        // Image should fit within slider
        expect(imgBox!.width).toBeLessThanOrEqual(sliderBox!.width + 1);
        expect(imgBox!.height).toBeLessThanOrEqual(sliderBox!.height + 1);

        // Slider should fit within dialog
        expect(sliderBox!.width).toBeLessThanOrEqual(dialogBox!.width + 1);

        // Container should be black
        const bg = await slider.evaluate((el) => getComputedStyle(el).backgroundColor);
        console.log(`[variety ${i}] slider bg: ${bg}, img: ${imgBox!.width}x${imgBox!.height}, slider: ${sliderBox!.width}x${sliderBox!.height}`);
        expect(bg).toMatch(/rgba?\(0,\s*0,\s*0/);

        await page.screenshot({ path: `test-results/variety-dialog-${i}.png`, fullPage: false });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        break;
      } else {
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
      }
    }
    expect(foundWithPhotos).toBe(true);
  });

  test('Variety detail dialog: close X is visible with white background', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.getByTestId('view-toggle-list').waitFor({ timeout: 10000 });
    await page.locator('[data-testid^="variety-name-link-"]').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const closeBtn = dialog.locator('button[data-slot=dialog-close]');
    await expect(closeBtn).toBeVisible();
    const bg = await closeBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[close btn] bg: ${bg}`);
    expect(bg).toMatch(/rgb\(255,\s*255,\s*255\)/);
  });

  test('Variety detail dialog: navigate through multiple photos', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.getByTestId('view-toggle-list').waitFor({ timeout: 10000 });

    // Find a variety with multiple images
    const links = page.locator('[data-testid^="variety-name-link-"]');
    const count = await links.count();
    for (let i = 0; i < Math.min(count, 15); i++) {
      await links.nth(i).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400);
      const counter = dialog.locator('text=/^\\d+\\s*\\/\\s*\\d+$/');
      if (await counter.count() > 0) {
        const text = await counter.first().textContent();
        const [_, total] = text!.match(/(\d+)\s*\/\s*(\d+)/)!;
        console.log(`[variety ${i}] has ${total} images`);
        if (parseInt(total) > 1) {
          // Click next
          await dialog.locator('button[aria-label="Next image"]').click();
          await page.waitForTimeout(200);
          const newText = await counter.first().textContent();
          expect(newText).not.toBe(text);

          // Image should still be within bounds
          const slider = dialog.getByTestId('variety-photo-slider');
          const img = slider.locator('img').first();
          const sliderBox = await slider.boundingBox();
          const imgBox = await img.boundingBox();
          expect(imgBox!.width).toBeLessThanOrEqual(sliderBox!.width + 1);
          expect(imgBox!.height).toBeLessThanOrEqual(sliderBox!.height + 1);

          await page.screenshot({ path: `test-results/variety-dialog-nav-${i}.png`, fullPage: false });
          await page.keyboard.press('Escape');
          return;
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });

  test('Gallery lightbox: image scales within bounds with black background', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Overview' }).waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Gallery' }).click();
    // Wait for gallery grid
    await page.waitForTimeout(1000);

    // Click the first image thumbnail
    const firstImg = page.locator('[class*="aspect-square"]').first();
    await firstImg.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);

    // Check that image fits within the dialog
    const dialogBox = await dialog.boundingBox();
    const img = dialog.locator('img[src*="/images/"]').first();
    const imgBox = await img.boundingBox();
    expect(dialogBox).toBeTruthy();
    expect(imgBox).toBeTruthy();

    console.log(`[gallery] dialog: ${dialogBox!.width}x${dialogBox!.height}, img: ${imgBox!.width}x${imgBox!.height}`);
    expect(imgBox!.width).toBeLessThanOrEqual(dialogBox!.width + 2);
    expect(imgBox!.height).toBeLessThanOrEqual(dialogBox!.height + 2);

    // Verify image container has black bg
    const imgContainer = img.locator('xpath=..');
    const bg = await imgContainer.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[gallery] img container bg: ${bg}`);
    expect(bg).toMatch(/rgba?\(0,\s*0,\s*0/);

    // Close button should be white
    const closeBtn = dialog.locator('button[data-slot=dialog-close]');
    const closeBg = await closeBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(closeBg).toMatch(/rgb\(255,\s*255,\s*255\)/);

    await page.screenshot({ path: 'test-results/gallery-lightbox.png', fullPage: false });
  });
});
