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

test.describe('Gallery sticky filter + PlantCard tweaks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Gallery filter bar is sticky and closer to tabs', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Gallery' }).click();
    await page.waitForTimeout(1200);

    const header = await page.locator('header').boundingBox();
    const tabsList = await page.locator('[role="tablist"]').boundingBox();
    const filterInput = await page.locator('input[placeholder*="Filter by name"]').first().boundingBox();

    expect(header).toBeTruthy();
    expect(tabsList).toBeTruthy();
    expect(filterInput).toBeTruthy();

    const tabsBottom = tabsList!.y + tabsList!.height;
    const gap = filterInput!.y - tabsBottom;
    console.log(`[gallery] tabs bottom: ${tabsBottom}, filter input top: ${filterInput!.y}, gap: ${gap}px`);
    // Should be under 10px now (was 19px)
    expect(gap).toBeLessThanOrEqual(10);

    // Verify sticky — scroll down and check filter bar stays near top
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(300);
    const filterAfter = await page.locator('input[placeholder*="Filter by name"]').first().boundingBox();
    expect(filterAfter).toBeTruthy();
    // Should remain visible in viewport (< 200px from top)
    expect(filterAfter!.y).toBeLessThan(200);
    console.log(`[gallery] after scroll, filter input top: ${filterAfter!.y}`);
  });

  test('Plant card: hero image is flush with top of card (no white gap)', async ({ page }) => {
    await page.goto(`${BASE}/plants`);
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });
    // Make sure we're in card view
    await page.getByTestId('view-toggle-card').click();
    await page.waitForTimeout(500);

    // Get first card & first image inside it
    const firstCard = page.locator('[data-slot="card"]').first();
    await firstCard.waitFor();
    const cardBox = await firstCard.boundingBox();
    const imgContainer = firstCard.locator('.aspect-square').first();
    const imgBox = await imgContainer.boundingBox();

    expect(cardBox).toBeTruthy();
    expect(imgBox).toBeTruthy();
    // Image container should start at card top (within 1px tolerance)
    const gap = imgBox!.y - cardBox!.y;
    console.log(`[card] card y=${cardBox!.y}, image y=${imgBox!.y}, gap=${gap}px`);
    expect(gap).toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'test-results/plant-card-flush.png', fullPage: false });
  });

  test('Plant card sizes: sm tooltip, md font, lg font', async ({ page }) => {
    await page.goto(`${BASE}/plants`);
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });
    await page.getByTestId('view-toggle-card').click();

    // Size lg (default)
    await page.waitForTimeout(500);
    let firstName = page.locator('[data-slot="card"]').first().locator('p.font-bold').first();
    let fontSize = await firstName.evaluate(el => getComputedStyle(el).fontSize);
    console.log(`[lg] font size: ${fontSize}`);
    // text-base = 16px
    expect(fontSize).toBe('16px');
    await page.screenshot({ path: 'test-results/card-size-lg.png' });

    // Switch to Medium
    await page.getByTitle('Medium thumbnails').click();
    await page.waitForTimeout(500);
    firstName = page.locator('[data-slot="card"]').first().locator('p.font-bold').first();
    fontSize = await firstName.evaluate(el => getComputedStyle(el).fontSize);
    console.log(`[md] font size: ${fontSize}`);
    // text-sm = 14px
    expect(fontSize).toBe('14px');
    await page.screenshot({ path: 'test-results/card-size-md.png' });

    // Tooltip — medium cards have title attribute
    const titleAttr = await firstName.getAttribute('title');
    expect(titleAttr).toBeTruthy();

    // Switch to Small
    await page.getByTitle('Small thumbnails').click();
    await page.waitForTimeout(500);
    firstName = page.locator('[data-slot="card"]').first().locator('p.font-bold').first();
    fontSize = await firstName.evaluate(el => getComputedStyle(el).fontSize);
    console.log(`[sm] font size: ${fontSize}`);
    expect(fontSize).toBe('12px');

    // Small cards should have title attribute (tooltip)
    const smallTitle = await firstName.getAttribute('title');
    expect(smallTitle).toBeTruthy();
    console.log(`[sm] tooltip title: ${smallTitle}`);
    await page.screenshot({ path: 'test-results/card-size-sm.png' });
  });

  test('Plant card: content padding reduced (tight top/bottom)', async ({ page }) => {
    await page.goto(`${BASE}/plants`);
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });
    await page.getByTestId('view-toggle-card').click();
    await page.waitForTimeout(500);

    // Get content container (after hero image)
    const card = page.locator('[data-slot="card"]').first();
    const heroImg = card.locator('.aspect-square').first();
    const contentArea = card.locator('.flex.flex-col.gap-0\\.5').first();

    const heroBox = await heroImg.boundingBox();
    const contentBox = await contentArea.boundingBox();
    const cardBox = await card.boundingBox();

    expect(heroBox).toBeTruthy();
    expect(contentBox).toBeTruthy();

    const padTop = contentBox!.y - (heroBox!.y + heroBox!.height);
    const padBottom = (cardBox!.y + cardBox!.height) - (contentBox!.y + contentBox!.height);
    console.log(`[card padding] top: ${padTop}px, bottom: ${padBottom}px (should be small)`);
    // With py-1 inner, expect ~4px top, modest bottom
    expect(padTop).toBeLessThanOrEqual(10);
    expect(padBottom).toBeLessThanOrEqual(10);
  });
});
