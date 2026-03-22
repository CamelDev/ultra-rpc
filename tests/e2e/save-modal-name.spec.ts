import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Save Modal Name Extension', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/save-name');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      electronApp = await electron.launch({
        args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
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

  test('should allow renaming request during save to collection', async () => {
    test.setTimeout(60000);

    // 1. Create a collection first
    console.log('Creating collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input', { state: 'visible' });
    await page.fill('.modal-body input', 'test-coll');
    await page.click('button:has-text("Create Collection")');
    
    // Wait for modal to close
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 10000 });

    await expect(page.locator('.tree-node-name').filter({ hasText: /^test-coll$/ })).toBeVisible({ timeout: 15000 });

    // 2. Trigger Save (Cmd+S)
    console.log('Triggering Save...');
    // We use Control+s which is handled by App.tsx for both Ctrl and Cmd
    await page.keyboard.press('Control+s'); 

    // 3. Verify Save Modal with Name Input
    console.log('Verifying Save Modal...');
    const saveModal = page.locator('.modal-content:has-text("Save Request")');
    await expect(saveModal).toBeVisible({ timeout: 10000 });
    
    const nameInput = saveModal.locator('input[type="text"]').first();
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue(/New Request/i);

    // 4. Change Name
    console.log('Changing name...');
    await nameInput.fill('My Custom Request');

    // 5. Select Collection and click OK
    console.log('Selecting collection and saving...');
    await page.click('.collection-modal-item:has-text("test-coll")');
    await page.click('button:has-text("OK")');

    // 6. Verify changes
    console.log('Verifying results...');
    // Wait for modal to disappear
    await page.waitForSelector('.modal-overlay', { state: 'hidden' });

    // Tab name should update
    await expect(page.locator('.tab-title').filter({ hasText: 'My Custom Request' })).toBeVisible({ timeout: 10000 });

    // Sidebar should show it under the collection
    // First, make sure the collection is expanded
    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^test-coll$/ }) }).first();
    const isExpanded = await collNode.locator('.tree-node-chevron svg.lucide-chevron-down').isVisible();
    if (!isExpanded) {
        await collNode.click();
    }

    await expect(page.locator('.tree-node-name').filter({ hasText: 'My Custom Request' })).toBeVisible({ timeout: 10000 });
  });
});
