import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockRestServer } from '../mocks/rest-server';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Variable Persistence Suite', () => {
  let mockServer: MockRestServer;
  let electronApp: any;
  let window: any;
  let userDataDir: string;

  test.beforeEach(async () => {
    mockServer = new MockRestServer(0);
    await mockServer.start();

    userDataDir = join(__dirname, '../../test-output/user-data/persistence');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
    if (mockServer) await mockServer.stop();
  });

  test('Variables set in post-response script should persist after app restart', async () => {
    // 1. Create a collection
    await window.click('button[data-tooltip="New Collection"]');
    await window.fill('.modal-body input', 'persistence-test-coll');
    await window.click('button:has-text("Create Collection")');
    
    // 2. Set URL
    const addressInput = window.locator('.address-input .cm-content');
    await addressInput.click();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await addressInput.fill(`${mockServer.url}/data`);

    // 3. Save request to collection
    await window.click('.save-btn');
    await window.click('.collection-modal-item:has-text("persistence-test-coll")');
    await window.click('.modal-footer button:has-text("OK")');

    // 4. Add Post-response script setting multiple variables directly
    await window.click('button:has-text("Post-response")');
    const scriptEditor = window.locator('.script-editor .cm-content');
    await scriptEditor.click();
    await window.keyboard.type('ultra.context.set("var_one", "val_one");\n');
    await window.keyboard.type('ultra.context.set("var_two", "val_two");');

    // 5. Send request
    await window.click('button:has-text("Send")');
    
    // Wait for console log of variables being set
    const consoleLogs = window.locator('.console-logs');
    await expect(consoleLogs).toContainText('LOG: Set context variable: var_one', { timeout: 10000 });
    await expect(consoleLogs).toContainText('LOG: Set context variable: var_two', { timeout: 10000 });

    // 6. Restart the app to verify persistence
    await electronApp.close();
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 15000 });

    // 7. Open collection variables modal and check values
    await window.click('.tree-node:has-text("persistence-test-coll") .coll-action-btn');
    await window.click('.coll-context-menu button:has-text("Variables")');
    
    const varRows = window.locator('.kv-row');
    await expect(varRows).toHaveCount(2);
    await expect(varRows.nth(0).locator('.kv-key')).toHaveValue('var_one');
    await expect(varRows.nth(0).locator('input.kv-value')).toHaveValue('val_one');
    await expect(varRows.nth(1).locator('.kv-key')).toHaveValue('var_two');
    await expect(varRows.nth(1).locator('input.kv-value')).toHaveValue('val_two');
  });
});
