import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('REST Request Lifecycle', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/rest-flow');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      console.log('Launching Electron...');
      electronApp = await electron.launch({
        args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      console.log('App launched, waiting for window...');
      window = await electronApp.firstWindow();
      
      console.log('Window found, waiting for .app-container...');
      await window.waitForSelector('.app-container', { timeout: 30000 });
      console.log('.app-container found!');
    } catch (err) {
      console.error('Failed to launch Electron app:', err);
      throw err;
    }
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should create, save, run and delete a REST request', async () => {
    // 1. Create a collection
    console.log('STEP 1: Creating initial collection...');
    console.log('Clicking New Collection button...');
    await window.click('button[data-tooltip="New Collection"]');
    
    console.log('Waiting for modal input...');
    await window.waitForSelector('.modal-body input', { timeout: 10000 });
    console.log('Filling collection name...');
    await window.fill('.modal-body input', 'initial-collection');
    
    console.log('Clicking Create Collection button...');
    await window.waitForSelector('button:has-text("Create Collection")', { timeout: 5000 });
    await window.click('button:has-text("Create Collection")');
    
    // Wait for the collection to appear in the list
    console.log('Waiting for collection to appear in tree...');
    const collHeader = window.locator('.tree-node').filter({ hasText: 'initial-collection' });
    await expect(collHeader).toBeVisible({ timeout: 15000 });
    console.log('Collection created!');
 
    // 2. Set URL in the address bar
    console.log('STEP 2: Setting URL...');
    await window.click('.address-input .cm-content');
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('https://jsonplaceholder.typicode.com/posts/1');
    console.log('URL set!');
 
    // 3. Saving to the collection via modal
    console.log('STEP 3: Triggering save modal...');
    await window.click('.save-btn');
    
    // Expect "Save Request" modal
    console.log('Waiting for Save Request modal...');
    const saveModalHeader = window.locator('.modal-content h3');
    await expect(saveModalHeader).toContainText('Save Request', { timeout: 10000 });
    console.log('Save modal visible');
    
    // Select the collection we created
    console.log('Selecting collection in modal...');
    await window.click('.collection-modal-item:has-text("initial-collection")');
    await window.click('.modal-footer button:has-text("OK")');
    console.log('Request saved via modal');
    
    // Verify it appears in the sidebar
    console.log('Verifying sidebar count...');
    const countElement = collHeader.locator('.coll-count');
    await expect(countElement).toHaveText('1', { timeout: 15000 });
    console.log('Sidebar count verified');
 
    // Expand if needed
    console.log('Expanding collection tree...');
    const isExpanded = await collHeader.locator('svg.chevron-down').isVisible();
    if (!isExpanded) {
      await collHeader.click();
    }
    const requestItem = window.locator('.tree-node').filter({ hasText: 'New Request' });
    await expect(requestItem).toBeVisible({ timeout: 10000 });
    console.log('Request visible in sidebar');
 
    // 4. Running the request
    console.log('STEP 4: Running request...');
    await window.click('.send-btn', { timeout: 5000 });
    console.log('Clicked Send button');
    
    // Wait for response
    console.log('Waiting for response status...');
    await expect(window.locator('.response-status-badge')).toBeVisible({ timeout: 20000 });
    await expect(window.locator('.response-status-badge')).toContainText('200');
    console.log('Request success (200 OK)');
 
    // 5. Deleting the request from collection
    console.log('STEP 5: Deleting request...');
    await requestItem.hover();
    await requestItem.locator('.coll-req-btn.danger').click();
    
    // Confirm Delete modal
    console.log('Confirming delete...');
    await expect(window.locator('.modal-content h3')).toContainText('Confirm Delete', { timeout: 5000 });
    await window.click('.modal-footer button:has-text("Delete")');
    
    // Verify it's gone
    await expect(requestItem).toBeHidden({ timeout: 10000 });
    console.log('Request deleted successfully!');
  });
});
