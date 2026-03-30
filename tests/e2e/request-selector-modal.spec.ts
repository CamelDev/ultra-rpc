import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('RequestSelectorModal E2E', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    const userDataDir = join(__dirname, '../../test-output/user-data/selector-modal-test');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should support searching and switching collections in RequestSelectorModal', async () => {
    test.setTimeout(90000);

    // 1. Setup collections structure
    console.log('Setting up collections...');
    
    // Collection A: Folder -> Request A
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'Collection A');
    await page.click('button:has-text("Create Collection")');
    
    // Create Folder X in Collection A
    const collA = page.locator('.tree-node').filter({ hasText: 'Collection A' }).first();
    await expect(collA).toBeVisible({ timeout: 10000 });
    await collA.locator('.coll-action-btn').click();
    await page.click('.coll-context-menu button:has-text("New Folder")');
    await page.fill('.modal-body input', 'Folder X');
    await page.click('button:has-text("Create Folder")');
    
    // Request inside Collection A
    console.log('Creating request in Collection A...');
    await page.click('.address-input .cm-content');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('https://httpbin.org/get/alpha');
    await page.click('.save-btn');
    await page.waitForSelector('.modal-content h3:has-text("Save Request")', { timeout: 10000 });
    await page.fill('.modal-body input', 'Request Alpha');
    await page.click('.collection-modal-item:has-text("Collection A")');
    await page.click('button:has-text("OK")');
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 5000 });

    // Collection B: Request B
    console.log('Creating Collection B...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'Collection B');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 5000 });
    
    await expect(page.locator('.tree-node-name').filter({ hasText: 'Collection B' })).toBeVisible({ timeout: 10000 });
    
    // Open a new tab for Bravo to ensure Save modal opens
    await page.click('.tab-add');
    
    // Save another request to Collection B
    await page.click('.address-input .cm-content');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('https://httpbin.org/get/bravo');
    await page.click('.save-btn');
    await page.waitForSelector('.modal-content h3:has-text("Save Request")', { timeout: 10000 });
    await page.fill('.modal-body input', 'Request Bravo');
    await page.click('.collection-modal-item:has-text("Collection B")');
    await page.click('button:has-text("OK")');

    // 2. Create Flow and Add Request Step
    console.log('Creating flow...');
    await page.click('button[data-tooltip="Flow Runner"]');
    await page.click('.flow-panel-actions button[title="New Flow"]');
    await page.click('.modal-content button:has-text("Create Flow")');
    await page.locator('.flow-item').filter({ hasText: 'New Flow' }).click();
    await page.waitForSelector('.flow-canvas', { timeout: 10000 });

    console.log('Adding request step...');
    await page.click('.btn-add-step');
    await page.click('.add-step-dropdown button:has-text("Request")');
    const stepCard = page.locator('.step-card').first();
    await expect(stepCard).toBeVisible({ timeout: 10000 });

    // Open Step if collapsed
    if (!await stepCard.locator('.step-card-content').isVisible()) {
      await stepCard.locator('button.icon-btn').first().click();
    }

    // 3. Open Selector Modal
    console.log('Testing Modal functionality...');
    const trigger = stepCard.locator('.selector-trigger');
    await trigger.click();
    
    const modal = page.locator('.request-selector-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Check collections in sidebar
    await expect(modal.locator('.collection-nav-item').filter({ hasText: 'Collection A' })).toBeVisible();
    await expect(modal.locator('.collection-nav-item').filter({ hasText: 'Collection B' })).toBeVisible();

    // 4. Test Switching Collections
    console.log('Switching between collections...');
    // Click Collection B
    await modal.locator('.collection-nav-item').filter({ hasText: 'Collection B' }).click();
    await expect(modal.locator('.tree-node-name').filter({ hasText: 'Request Bravo' })).toBeVisible();
    
    // Click Collection A
    await modal.locator('.collection-nav-item').filter({ hasText: 'Collection A' }).click();
    // Verify Folder X is visible
    await expect(modal.locator('.tree-node-name').filter({ hasText: 'Folder X' })).toBeVisible();
    
    // 5. Test Search
    console.log('Testing search functionality...');
    const searchInput = modal.locator('.request-search-container input');
    await searchInput.fill('Alpha');
    
    // Verify results
    await expect(modal.locator('.tree-node-name').filter({ hasText: 'Request Alpha' })).toBeVisible();
    await expect(modal.locator('.tree-node-name').filter({ hasText: 'Folder X' })).toBeHidden(); // Alpha search should hide the folder itself unless it matched
    
    // Clear search
    await modal.locator('.request-search-container button.btn-ghost').click();
    await expect(modal.locator('.tree-node-name').filter({ hasText: 'Folder X' })).toBeVisible();

    // 6. Test Navigation and Selection
    console.log('Final selection...');
    // Expand Folder X if collapsed
    const chevronX = modal.locator('.tree-node').filter({ hasText: 'Folder X' }).locator('.tree-node-chevron');
    if (await modal.locator('.tree-node-name').filter({ hasText: 'Request Alpha' }).isHidden()) {
        await chevronX.click();
    }
    
    await modal.locator('.tree-node-name').filter({ hasText: 'Request Alpha' }).click();
    
    // Modal should close
    await expect(modal).toBeHidden({ timeout: 5000 });
    
    // Step card should update its label
    await expect(trigger.locator('.trigger-text')).toHaveText('Request Alpha');
    
    console.log('E2E Selector Modal Passed!');
  });
});
