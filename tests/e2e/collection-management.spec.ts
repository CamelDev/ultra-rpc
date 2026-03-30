import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Collection Management', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/coll');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      electronApp = await electron.launch({
        args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      page = await electronApp.firstWindow();
      page.on('console', (msg: any) => console.log(`[APP CONSOLE] ${msg.text()}`));
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

  test('should perform full collection management lifecycle', async () => {
    test.setTimeout(120000);
    const screenshot = async (name: string) => {
      await page.screenshot({ path: join(__dirname, `../../test-output/results/screenshots/${name}.png`) });
    };

    const setCMValue = async (selector: string, value: string) => {
      await page.waitForSelector(selector, { state: 'attached', timeout: 20000 });
      await page.waitForFunction((s: string) => {
        const container = document.querySelector(s);
        if (!container) return false;
        const editor = container.querySelector('.editor-container');
        if (!editor) return false;
        return (editor as any).cmView && (editor as any).cmView.view;
      }, selector, { timeout: 20000 });

      await page.evaluate(({ s, val }: { s: string, val: string }) => {
        const container = document.querySelector(s);
        const editor = container?.querySelector('.editor-container') as any;
        const { view } = editor.cmView;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: val }
        });
      }, { s: selector, val: value });
    };

    try {
      // 1. Create a collection
      console.log('STEP 1: Creating collection...');
      await page.click('button[data-tooltip="New Collection"]');
      await page.waitForSelector('.modal-body input');
      await page.fill('.modal-body input', 'test-coll');
      await page.click('button:has-text("Create Collection")');
      
      await expect(page.locator('.tree-node-name').filter({ hasText: /^test-coll$/ })).toBeVisible({ timeout: 15000 });
      console.log('Collection created!');

      // 2. Rename collection
      console.log('STEP 2: Renaming collection...');
      const collToRename = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^test-coll$/ }) }).first();
      await collToRename.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Rename")');
      
      await page.waitForSelector('.coll-rename-input', { timeout: 5000 });
      await page.fill('.coll-rename-input', 'renamed-coll');
      await page.keyboard.press('Enter');
      
      // Wait for the name to change
      const renamedHeader = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^renamed-coll$/ }) }).first();
      await expect(renamedHeader).toBeVisible({ timeout: 15000 });
      console.log('Collection renamed!');

      // 3. Clone collection
      console.log('STEP 3: Cloning collection...');
      await renamedHeader.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Clone")');
      
      const clonedHeader = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /copy/i }) }).first();
      await expect(clonedHeader).toBeVisible({ timeout: 15000 });
      console.log('Collection cloned!');

      // 4. Create Folder in renamed-coll
      console.log('STEP 4: Creating folder...');
      const targetColl = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^renamed-coll$/ }) }).first();
      await targetColl.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      
      const newFolderBtn = page.locator('.coll-context-menu button:has-text("New Folder")');
      await expect(newFolderBtn).toBeVisible({ timeout: 5000 });
      await newFolderBtn.click({ force: true });
      
      // Wait for Folder Modal
      await page.waitForSelector('.modal-overlay', { timeout: 10000 });
      await page.fill('.modal-body input', 'my-folder');
      await page.click('button:has-text("Create Folder")');
      
      // Expand collection to see folder
      await targetColl.click();
      
      const folderNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^my-folder$/ }) }).first();
      await expect(folderNode).toBeVisible({ timeout: 15000 });
      console.log('Folder created!');

      // 5. Rename Folder
      console.log('STEP 5: Renaming folder...');
      await folderNode.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Rename")');
      
      await page.waitForSelector('.coll-rename-input', { timeout: 5000 });
      await page.fill('.coll-rename-input', 'final-folder');
      await page.keyboard.press('Enter');
      
      const finalFolderNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^final-folder$/ }) }).first();
      await expect(finalFolderNode).toBeVisible({ timeout: 15000 });
      // 7. Collection Variables
      console.log('STEP 7: Editing collection variables...');
      await renamedHeader.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Variables")');
      
      await page.waitForSelector('.modal-overlay', { timeout: 5000 });
      await expect(page.locator('.modal-header h3')).toContainText('Context Variables: renamed-coll');
      
      // Add a variable
      await page.waitForTimeout(1000); // Wait for modal animation
      const modal = page.locator('.modal-content');
      
      console.log('Clicking Add variable...');
      await modal.locator('.kv-add').first().evaluate((el: any) => el.click());
      await screenshot('after-kv-add');
      
      // Wait for the row to appear in the DOM
      await modal.locator('.kv-row').first().waitFor({ state: 'visible', timeout: 10000 });
      
      const keySelector = '.modal-content .kv-row .kv-key';
      const valSelector = '.modal-content .kv-row .kv-value';
      
      await setCMValue(keySelector, 'coll_key');
      await setCMValue(valSelector, 'coll_val');
      
      await modal.locator('.modal-footer button:has-text("Save & Close")').click();
      await page.waitForSelector('.modal-overlay', { state: 'hidden' });
      
      // Verify persistence
      await renamedHeader.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Variables")');
      await page.waitForSelector('.modal-overlay', { timeout: 5000 });
      
      // Look for the text in the CM editor
      const updatedModal = page.locator('.modal-content');
      await expect(updatedModal.locator('.kv-row').first()).toContainText('coll_key');
      await expect(updatedModal.locator('.kv-row').first()).toContainText('coll_val');
      
      await updatedModal.locator('.modal-footer button:has-text("Save & Close")').click();
      console.log('Collection variables verified!');

      // 8. Postman Collection Import
      console.log('STEP 8: Importing Postman collection...');
      const postmanFile = join(__dirname, '../../tests/mocks/postman-collection.json');
      
      // Stub main process dialog
      await electronApp.evaluate(async (params: any, filePath: string) => {
        const dialog = params.dialog as any;
        dialog.showOpenDialog = () => Promise.resolve({
          canceled: false,
          filePaths: [filePath]
        }) as any;
      }, postmanFile);
      await page.click('button[data-tooltip="Import collection"]');
      
      const importedColl = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /postman/i }) }).first();
      await expect(importedColl).toBeVisible({ timeout: 20000 });
      
      await importedColl.click(); // Expand
      await expect(page.locator('.tree-node-name').filter({ hasText: /^my-folder$/i }).or(page.locator('.tree-node-name').filter({ hasText: /^My Folder$/i }))).toBeVisible({ timeout: 10000 });
      await page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^my-folder$/i }).or(page.locator('.tree-node-name').filter({ hasText: /^My Folder$/i })) }).first().click(); // Expand folder
      await expect(page.locator('.tree-node-name').filter({ hasText: /^postman-request$/i }).or(page.locator('.tree-node-name').filter({ hasText: /^Postman Request$/i }))).toBeVisible({ timeout: 10000 });
      console.log('Postman collection imported successfully!');

      // 6. Delete the cloned collection
      console.log('STEP 6: Deleting clone...');
      await clonedHeader.locator('.coll-action-btn').click();
      await page.waitForSelector('.coll-context-menu', { timeout: 5000 });
      await page.click('.coll-context-menu button:has-text("Delete")');
      
      await expect(page.locator('.modal-content h3')).toContainText('Confirm Delete', { timeout: 5000 });
      await page.click('.modal-footer button:has-text("Delete")');
      await expect(clonedHeader).toBeHidden({ timeout: 15000 });
      console.log('Clone deleted!');
    } catch (err) {
      await screenshot('failure-diagnostics');
      throw err;
    }
  });
});
