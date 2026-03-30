import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Cloning Verification', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/flow-cloning-test');
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

  test('should clone an existing flow with steps', async () => {
    test.setTimeout(90000);
    
    // 1. Create Collection (needed for flows)
    console.log('Creating collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input', { timeout: 5000 });
    await page.fill('.modal-body input', 'Cloning Test Coll');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: 'Cloning Test Coll' })).toBeVisible({ timeout: 15000 });

    // 2. Create Flow
    console.log('Creating flow...');
    await page.click('button[data-tooltip="Flow Runner"]');
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 15000 });
    await newFlowBtn.click();
    
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-content button:has-text("Create Flow")');
    const flowItem = page.locator('.flow-item-name').filter({ hasText: 'New Flow' }).first();
    await expect(flowItem).toBeVisible({ timeout: 15000 });
    
    // 3. Add a step to the flow
    console.log('Adding step to original flow...');
    await flowItem.click();
    await page.waitForSelector('.flow-canvas', { timeout: 10000 });
    await page.click('.btn-add-step');
    await page.click('.add-step-dropdown button:has-text("Request")');
    await expect(page.locator('.step-card')).toBeVisible({ timeout: 10000 });

    // 4. Clone the Flow
    console.log('Cloning the flow...');
    const flowRow = page.locator('.flow-item').filter({ hasText: 'New Flow' }).first();
    await flowRow.hover();
    
    await flowRow.locator('.more-btn').click();
    const cloneBtn = page.locator('.flow-context-menu button:has-text("Clone")');
    await expect(cloneBtn).toBeVisible({ timeout: 5000 });
    await cloneBtn.click();

    // 5. Verify Clone Modal
    console.log('Verifying clone modal...');
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    const modalTitle = page.locator('.modal-header h3');
    await expect(modalTitle).toHaveText('Clone Flow');
    
    const nameInput = page.locator('.modal-body input').first();
    await expect(nameInput).toHaveValue('New Flow Copy');
    
    // 6. Confirm Clone
    console.log('Confirming clone...');
    await page.click('.modal-footer button:has-text("Clone Flow")');

    // 7. Verify Cloned Flow exists and is active
    console.log('Verifying cloned flow...');
    const clonedFlowItem = page.locator('.flow-item-name').filter({ hasText: 'New Flow Copy' });
    await expect(clonedFlowItem).toBeVisible({ timeout: 15000 });
    
    const activeTab = page.locator('.tab-item.tab-active');
    await expect(activeTab).toContainText('New Flow Copy', { timeout: 10000 });

    // 8. Verify steps were preserved in the clone
    console.log('Verifying steps in cloned flow...');
    await expect(page.locator('.step-card')).toBeVisible({ timeout: 10000 });
    
    console.log('Verification successful!');
  });
});
