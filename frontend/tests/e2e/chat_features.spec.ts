import { test, expect } from '@playwright/test';

test.describe('Chat History and Archiving Features', () => {
    test.beforeEach(async ({ page }) => {
        // Mock authentication
        await page.addInitScript(() => {
            window.localStorage.setItem('auth-storage', JSON.stringify({
                state: {
                    user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'user' },
                    accessToken: 'mock-token',
                    isAuthenticated: true
                },
                version: 0
            }));
        });

        // Mock API response for models
        await page.route('**/api/chat/models', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ id: 'mock-model', name: 'Mock Model', provider: 'Mock' }])
            });
        });

        // Mock API response for conversations
        await page.route('**/api/chat/conversations?archived=false*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { id: 1, title: 'Active Chat 1', model: 'mock-model', is_archived: false, updated_at: new Date().toISOString() }
                ])
            });
        });

        await page.route('**/api/chat/conversations?archived=true*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { id: 2, title: 'Archived Chat 1', model: 'mock-model', is_archived: true, updated_at: new Date().toISOString() }
                ])
            });
        });
    });

    test('should show archive toggle and handle archiving UI', async ({ page }) => {
        await page.goto('/');

        // 1. Check if history is visible
        await expect(page.locator('text=Recent Chats')).toBeVisible();
        await expect(page.locator('text=Active Chat 1')).toBeVisible();

        // 2. Check for Archive button (hover state)
        const chatItem = page.locator('div:has-text("Active Chat 1")').first();
        await chatItem.hover();
        const archiveButton = chatItem.locator('button[title="Archive"]');
        await expect(archiveButton).toBeVisible();

        // 3. Toggle to Archived view
        const toggleButton = page.locator('button[title="Show archived chats"]');
        await toggleButton.click();

        // 4. Check if archived view is shown
        await expect(page.getByText('Archived', { exact: true })).toBeVisible();
        await expect(page.locator('text=Archived Chat 1')).toBeVisible();
        await expect(page.locator('button[title="Show current chats"]')).toBeVisible();
    });

    test('should show delete button on hover', async ({ page }) => {
        await page.goto('/');

        const chatItem = page.locator('div:has-text("Active Chat 1")').first();
        await chatItem.hover();
        const deleteButton = chatItem.locator('button[title="Delete"]');
        await expect(deleteButton).toBeVisible();
    });
});
