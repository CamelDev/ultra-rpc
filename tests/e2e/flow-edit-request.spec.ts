import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Edit Request Integration', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/flow-edit-test');
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      
      electronApp = await electron.launch({
        args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      page = await electronApp.firstWindow();
      await page.setViewportSize({ width: 1280, height: 800 });
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

  test('should navigate from flow step to saved request', async () => {
    test.setTimeout(60000);
    const screenshot = async (name: string) => {
      const path = join(__dirname, `../../test-output/results/screenshots/${name}.png`);
      await page.screenshot({ path });
      console.log(`Screenshot saved: ${path}`);
    };
    
    // 1. Create Collection
    console.log('Creating collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input', { timeout: 5000 });
    await page.fill('.modal-body input', 'Test Collection');
    await screenshot('before-create-coll');
    await page.click('button:has-text("Create Collection")');
    
    console.log('Waiting for collection node...');
    try {
      await expect(page.locator('.tree-node-name').filter({ hasText: 'Test Collection' })).toBeVisible({ timeout: 15000 });
    } catch (e) {
      await screenshot('fail-coll-visibility');
      throw e;
    }

    // 2. Create Request in Collection
    console.log('Creating request...');
    // Type name in address bar to have something to save
    await page.click('.address-input .cm-content');
    await page.keyboard.type('https://httpbin.org/get');
    
    await page.click('.save-btn');
    await page.waitForSelector('.modal-content h3:has-text("Save Request")', { timeout: 10000 });
    
    // Fill name and select collection
    await page.fill('.modal-body input', 'Test Request');
    await page.click('.collection-modal-item:has-text("Test Collection")');
    await page.click('button:has-text("OK")');
    
    // Ensure request is saved and visible in sidebar
    const collNode = page.locator('.tree-node').filter({ hasText: 'Test Collection' }).first();
    
    // Ensure request is expanded and visible
    await collNode.click();
    await expect(page.locator('.tree-node-name').filter({ hasText: 'Test Request' })).toBeVisible({ timeout: 15000 });

    // 3. Create Flow
    console.log('Creating flow...');
    await page.click('button[data-tooltip="Flow Runner"]');
    
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 15000 });
    await newFlowBtn.click();
    
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-content button:has-text("Create Flow")');
    await expect(page.locator('.flow-item-name').filter({ hasText: 'New Flow' })).toBeVisible({ timeout: 15000 });
    
    // Open the flow if not already open
    await page.locator('.flow-item').filter({ hasText: 'New Flow' }).click();
    await page.waitForSelector('.flow-canvas', { timeout: 10000 });

    // 4. Add Request Step and Link to Request
    console.log('Adding request step...');
    await page.click('.btn-add-step');
    await page.click('.add-step-dropdown button:has-text("Request")');
    
    const stepCard = page.locator('.step-card').first();
    await expect(stepCard).toBeVisible({ timeout: 10000 });
    
    // 5. Select the request from dropdown
    console.log('Selecting request in step...');
    // Expand step if needed
    const isExpanded = await stepCard.locator('.step-card-content').isVisible();
    if (!isExpanded) {
      await stepCard.locator('button.icon-btn').first().click();
    }
    
    const trigger = stepCard.locator('.selector-trigger');
    await expect(trigger).toBeVisible({ timeout: 5000 });
    await trigger.click();
    
    const modal = page.locator('.request-selector-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    
    // Select the request from the tree
    await modal.locator('.tree-node-name').filter({ hasText: 'Test Request' }).click();
    
    // The modal should close after selection
    await expect(modal).toBeHidden({ timeout: 5000 });
    
    // 6. Verify "Edit Request" button and click it
    console.log('Verifying Edit Request button...');
    const editBtn = stepCard.locator('button.edit-request-btn');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await expect(editBtn).toContainText('Edit Request');
    
    await editBtn.click();
    
    // 7. Assert that the request tab is active
    console.log('Verifying tab switch...');
    const activeTab = page.locator('.tab-item.tab-active');
    await expect(activeTab).toContainText('Test Request', { timeout: 10000 });
    console.log('E2E Test Passed!');
  });
});
