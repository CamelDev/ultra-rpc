import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Conditional Collection Deletion', () => {
  let electronApp: any;
  let page: any;
  const userDataDir = join(__dirname, '../../test-output/user-data/conditional-del');

  test.beforeEach(async () => {
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should delete collection and files when checkbox is checked', async () => {
    // 1. Create a collection
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'to-be-deleted');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^to-be-deleted$/ })).toBeVisible();

    const collPath = join(userDataDir, 'collections/to-be-deleted');
    expect(fs.existsSync(collPath)).toBe(true);

    // 2. Delete with checkbox checked
    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^to-be-deleted$/ }) }).first();
    await collNode.locator('.coll-action-btn').click();
    await page.click('.coll-context-menu button:has-text("Delete")');
    
    await page.check('input[type="checkbox"]'); // Also delete request files
    await page.click('.modal-footer button:has-text("Delete")');

    await expect(collNode).toBeHidden();
    expect(fs.existsSync(collPath)).toBe(false);
  });

  test('should remove collection from UI but keep files when checkbox is unchecked', async () => {
    // 1. Create a collection
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'keep-files');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^keep-files$/ })).toBeVisible();

    const collPath = join(userDataDir, 'collections/keep-files');
    expect(fs.existsSync(collPath)).toBe(true);

    // 2. Delete with checkbox unchecked (default)
    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^keep-files$/ }) }).first();
    await collNode.locator('.coll-action-btn').click();
    await page.click('.coll-context-menu button:has-text("Delete")');
    
    // Checkbox should be unchecked by default
    const isChecked = await page.isChecked('input[type="checkbox"]');
    expect(isChecked).toBe(false);

    await page.click('.modal-footer button:has-text("Delete")');

    await expect(collNode).toBeHidden();
    
    // The collection should be moved to backups
    const backupDir = join(userDataDir, 'backups/collections');
    expect(fs.existsSync(backupDir)).toBe(true);
    const backups = fs.readdirSync(backupDir);
    expect(backups.some(b => b.startsWith('keep-files_'))).toBe(true);
    
    // The original path should be gone
    expect(fs.existsSync(collPath)).toBe(false);
  });
});
