import { test, expect } from '@playwright/test';

// E2E test for N4: is_manually_enabled toggle in Admin > Models.
// Requires a running server (npm run dev or production build).

test.describe('Admin Models — Forza abilitazione toggle (N4)', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin (adjust credentials to your local .env)
    await page.goto('/login');
    await page.fill('[name="email"]', process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com');
    await page.fill('[name="password"]', process.env.E2E_ADMIN_PASSWORD ?? 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/chat**', { timeout: 10_000 });
    await page.goto('/admin/models');
    await page.waitForSelector('[role="switch"]', { timeout: 10_000 });
  });

  test('toggle renders for each model card', async ({ page }) => {
    const toggles = page.locator('[role="switch"]');
    await expect(toggles.first()).toBeVisible();
  });

  test('toggle changes aria-checked and calls PATCH API', async ({ page }) => {
    const firstToggle = page.locator('[role="switch"]').first();
    const initialChecked = await firstToggle.getAttribute('aria-checked');

    const [patchRequest] = await Promise.all([
      page.waitForRequest(req => req.method() === 'PATCH' && req.url().includes('/admin/models/')),
      firstToggle.click(),
    ]);

    const body = patchRequest.postDataJSON();
    expect(body).toHaveProperty('is_manually_enabled');
    expect(typeof body.is_manually_enabled).toBe('boolean');

    const expectedChecked = initialChecked === 'true' ? 'false' : 'true';
    await expect(firstToggle).toHaveAttribute('aria-checked', expectedChecked);
  });

  test('toggle reset (false) sends is_manually_enabled: false', async ({ page }) => {
    // Find a model card whose toggle is currently ON (aria-checked=true)
    const onToggle = page.locator('[role="switch"][aria-checked="true"]').first();
    const count = await onToggle.count();
    if (count === 0) {
      test.skip(); // No enabled model to test reset flow
      return;
    }

    const [patchRequest] = await Promise.all([
      page.waitForRequest(req => req.method() === 'PATCH' && req.url().includes('/admin/models/')),
      onToggle.click(),
    ]);

    const body = patchRequest.postDataJSON();
    expect(body.is_manually_enabled).toBe(false);
  });
});
