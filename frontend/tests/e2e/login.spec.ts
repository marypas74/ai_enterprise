import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Enterprise AI Chat/);
});

test('login page loads', async ({ page }) => {
    await page.goto('/login');

    // Check if login heading is visible
    await expect(page.getByRole('heading', { name: 'Enterprise AI' })).toBeVisible();
});
