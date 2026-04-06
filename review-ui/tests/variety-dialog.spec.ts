import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'htfg-admin-2026';

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // After login we land on /admin (not /admin/login)
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 10000 });
}

test.describe('Variety detail dialog + view toggles', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Plants page has view toggle that persists (card default)', async ({ page }) => {
    await page.goto(`${BASE}/plants`);
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });

    // Card toggle should exist and be active by default
    const cardBtn = page.getByTestId('view-toggle-card');
    const listBtn = page.getByTestId('view-toggle-list');
    await expect(cardBtn).toHaveAttribute('aria-pressed', 'true');

    // Switch to list view
    await listBtn.click();
    await expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('table')).toBeVisible();

    // Reload — list should persist
    await page.reload();
    await page.getByTestId('view-toggle-card').waitFor({ timeout: 10000 });
    await expect(page.getByTestId('view-toggle-list')).toHaveAttribute('aria-pressed', 'true');

    // Switch back to card for next tests
    await page.getByTestId('view-toggle-card').click();
    await expect(page.getByTestId('view-toggle-card')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Variety dialog: click opens, edit & save persists to DB', async ({ page }) => {
    // Go to a plant with varieties — banana has many
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Overview' }).waitFor({ timeout: 10000 });

    // Click the Varieties tab
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.waitForSelector('[data-testid="view-toggle-list"]', { timeout: 10000 });

    // The list view should be the default
    await expect(page.getByTestId('view-toggle-list')).toHaveAttribute('aria-pressed', 'true');

    // Click the first variety name to open dialog
    const firstLink = page.locator('[data-testid^="variety-name-link-"]').first();
    await expect(firstLink).toBeVisible();
    const varietyName = await firstLink.textContent();
    await firstLink.click();

    // Dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Click edit
    await dialog.getByRole('button', { name: 'Edit' }).click();

    // Fill in a distinct description with timestamp
    const stamp = `playwright test ${Date.now()}`;
    const descField = dialog.locator('#variety-Description');
    await descField.fill(stamp);

    // Fill alternative names
    const altStamp = `alt-${Date.now()}`;
    const altField = dialog.locator('#variety-Alternative_Names');
    await altField.fill(altStamp);

    // Save
    await dialog.getByRole('button', { name: 'Save' }).click();
    // Wait for exit from edit mode (Save button disappears)
    await expect(dialog.getByRole('button', { name: 'Save' })).not.toBeVisible({ timeout: 5000 });

    // The dialog should now show the new description
    await expect(dialog).toContainText(stamp);
    await expect(dialog).toContainText(altStamp);

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reload page and verify persistence
    await page.reload();
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.waitForSelector('[data-testid^="variety-name-link-"]', { timeout: 10000 });

    // Find the same variety name (should still be present)
    const sameLink = page.getByRole('button', { name: varietyName!, exact: true }).first();
    await sameLink.click();
    const dialog2 = page.getByRole('dialog');
    await expect(dialog2).toBeVisible();
    await expect(dialog2).toContainText(stamp);
    await expect(dialog2).toContainText(altStamp);
  });

  test('Varieties tab: switch to card view shows cards', async ({ page }) => {
    await page.goto(`${BASE}/plants/banana`);
    await page.getByRole('tab', { name: 'Overview' }).waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Varieties' }).click();
    await page.waitForSelector('[data-testid="view-toggle-card"]', { timeout: 10000 });

    // Click card view
    await page.getByTestId('view-toggle-card').click();
    await expect(page.getByTestId('view-toggle-card')).toHaveAttribute('aria-pressed', 'true');

    // Card grid should appear
    await expect(page.getByTestId('variety-card-grid')).toBeVisible();

    // Click a card — opens dialog
    const firstCard = page.locator('[data-testid^="variety-card-"]').first();
    await firstCard.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Reset to list view for next run
    await page.keyboard.press('Escape');
    await page.getByTestId('view-toggle-list').click();
  });
});
