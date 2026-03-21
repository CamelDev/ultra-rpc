import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Folder Support', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-user-data-folders');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      electronApp = await electron.launch({
        args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      electronApp.process().stdout!.on('data', (data: Buffer) => console.log(`[STDOUT] ${data.toString().trim()}`));
      electronApp.process().stderr!.on('data', (data: Buffer) => console.log(`[STDERR] ${data.toString().trim()}`));

      page = await electronApp.firstWindow();
      page.on('console', (msg: any) => console.log(`[RENDERER] ${msg.text()}`));
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

  test('should create and manage folders from the header menu', async () => {
    test.setTimeout(60000);

    // 1. Create a collection first
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input');
    await page.fill('.modal-body input', 'coll-1');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^coll-1$/ })).toBeVisible({ timeout: 10000 });

    // 2. Click New Folder button in header
    console.log('Clicking New Folder button...');
    await page.click('button[data-tooltip="New Folder"]');
    console.log('Waiting for Folder Modal...');
    await page.waitForSelector('.modal-overlay h3:has-text("New Folder")', { timeout: 10000 });
    await page.fill('.modal-body input', 'Folder-A');
    await page.click('button:has-text("Create Folder")');

    // 3. Verify Folder-A appeared
    console.log('Expanding collection to see Folder-A...');
    try {
      await page.locator('.tree-node-chevron').first().click({ timeout: 5000 });
    } catch (e) {
      console.log('Chevron click failed, trying node click...');
      await page.click('.tree-node:has-text("coll-1")');
    }
    
    console.log('Verifying Folder-A appeared...');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^Folder-A$/ })).toBeVisible({ timeout: 15000 });

    // Create Nested Folder (select Folder-A first)
    console.log('Creating nested folder...');
    const folderANode = page.locator('.tree-node').filter({ hasText: 'Folder-A' }).first();
    await folderANode.click(); // Selects and EXPANDS
    await page.click('button[data-tooltip="New Folder"]');
    await page.fill('.modal-body input', 'Sub-Folder');
    await page.click('button:has-text("Create Folder")');

    // Verify Sub-Folder appeared (should already wrap-expand or stay expanded)
    console.log('Verifying Sub-Folder appeared...');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^Sub-Folder$/ })).toBeVisible({ timeout: 15000 });

    // 5. Rename Folder
    await page.locator('.tree-node').filter({ hasText: 'Sub-Folder' }).locator('.coll-action-btn').click();
    await page.waitForSelector('.coll-context-menu');
    await page.click('.coll-context-menu button:has-text("Rename")');
    await page.fill('.coll-rename-input', 'Renamed-Sub');
    await page.keyboard.press('Enter');

    await expect(page.locator('.tree-node-name').filter({ hasText: /^Renamed-Sub$/ })).toBeVisible({ timeout: 10000 });

    // 6. Delete Folder
    await page.locator('.tree-node').filter({ hasText: 'Renamed-Sub' }).locator('.coll-action-btn').click();
    await page.waitForSelector('.coll-context-menu');
    await page.click('.coll-context-menu button:has-text("Delete")');
    await page.click('.modal-footer button:has-text("Delete")');

    await expect(page.locator('.tree-node-name').filter({ hasText: /^Renamed-Sub$/ })).toBeHidden({ timeout: 10000 });
  });
});
