import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Collection Search', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-user-data-search');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      electronApp = await electron.launch({
        args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      page = await electronApp.firstWindow();
      await page.waitForSelector('.app-container', { timeout: 30000 });
    } catch (err) {
      console.error('Failed to launch Electron app:', err);
      throw err;
    }
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should filter tree based on search input', async () => {
    test.setTimeout(60000);

    // 1. Setup: Create a structure
    // Create Collection "alpha" (lowercase to match storage)
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input', { timeout: 10000 });
    await page.fill('.modal-body input', 'alpha');
    await page.click('button:has-text("Create Collection")');
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 10000 });
    
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible({ timeout: 15000 });

    const alphaNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^alpha$/ }) }).first();

    // Create Folder "beta" in alpha
    await alphaNode.locator('.coll-action-btn').click();
    await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
    await page.click('.coll-context-menu button:has-text("New Folder")');
    await page.waitForSelector('.modal-body input', { timeout: 10000 });
    await page.fill('.modal-body input', 'beta');
    await page.click('button:has-text("Create Folder")');
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 10000 });
    
    // Expand alpha
    await alphaNode.click();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^beta$/ })).toBeVisible({ timeout: 10000 });

    // Create another collection "delta"
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'delta');
    await page.click('button:has-text("Create Collection")');
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 10000 });
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeVisible({ timeout: 15000 });

    const searchInput = page.locator('.coll-search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // 2. Test 3-char minimum: search "al" should not filter
    await searchInput.fill('al');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeVisible();

    // 3. Search "alp" (3 chars): should show alpha, hide delta
    await searchInput.fill('alp');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeHidden();

    // 4. Test branch visibility: search "bet" (3 chars)
    // beta is inside alpha. If we search "bet", alpha should be visible too.
    await searchInput.fill('bet');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^beta$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeHidden();

    // 5. Case-insensitivity
    await searchInput.fill('ALPHA');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeHidden();

    // 6. Clear search via 'X' button
    await page.click('.coll-search-clear');
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^alpha$/ })).toBeVisible();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^delta$/ })).toBeVisible();
  });
});
