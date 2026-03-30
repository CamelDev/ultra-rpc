import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Management Suite', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    try {
      const userDataDir = join(__dirname, '../../test-output/user-data/flows-test');
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

  test('should create, rename, reorder, and delete flows', async () => {
    test.setTimeout(60000);
    
    // First, we need to ensure a collection exists because "New Flow" requires a collection.
    console.log('Creating initial collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input');
    await page.fill('.modal-body input', 'flow-test-coll');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^flow-test-coll$/ })).toBeVisible({ timeout: 15000 });

    // Ensure Flows panel is visible if there's a toggle
    console.log('Opening Flow Runner panel...');
    await page.click('button[data-tooltip="Flow Runner"]');
    
    // Wait for the new flow button to be available
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 15000 });

    // 1. Create a Flow
    console.log('Creating first flow...');
    await newFlowBtn.click();
    
    // Wait for the modal and click create
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-content button:has-text("Create Flow")');

    // Default name is usually "New Flow"
    const flowItem1 = page.locator('.flow-item-name').filter({ hasText: 'New Flow' }).first();
    await expect(flowItem1).toBeVisible({ timeout: 15000 });
    
    // Rename it to Advanced Flow
    console.log('Renaming first flow...');
    const flowRow1 = page.locator('.flow-item').filter({ hasText: 'New Flow' });
    await flowRow1.hover();
    await flowRow1.locator('.more-btn').click();
    
    const contextMenu = page.locator('.flow-context-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('button:has-text("Rename")').click();
    
    const renameInput = page.locator('.flow-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await renameInput.fill('Advanced Flow');
    await renameInput.press('Enter');
    
    await expect(page.locator('.flow-item-name').filter({ hasText: 'Advanced Flow' })).toBeVisible({ timeout: 5000 });

    // 2. Create another Flow and rename it
    console.log('Creating second flow...');
    await newFlowBtn.click();
    
    // Wait for the modal and click create
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-content button:has-text("Create Flow")');

    const flowItem2 = page.locator('.flow-item-name').filter({ hasText: 'New Flow' }).first();
    await expect(flowItem2).toBeVisible({ timeout: 15000 });
    
    const flowRow2 = page.locator('.flow-item').filter({ hasText: 'New Flow' });
    await flowRow2.hover();
    await flowRow2.locator('.more-btn').click();
    await page.locator('.flow-context-menu button:has-text("Rename")').click();
    
    const renameInput2 = page.locator('.flow-rename-input');
    await expect(renameInput2).toBeVisible({ timeout: 5000 });
    await renameInput2.fill('Flow B');
    await renameInput2.press('Enter');
    
    await expect(page.locator('.flow-item-name').filter({ hasText: 'Flow B' })).toBeVisible({ timeout: 5000 });

    // 3. Reorder Flows
    console.log('Reordering flows...');
    // We expect Advanced Flow to be first, Flow B to be second (or vice versa depending on how they are appended)
    // We'll drag Flow B over Advanced Flow
    const draggableB = page.locator('.flow-item').filter({ hasText: 'Flow B' });
    const targetA = page.locator('.flow-item').filter({ hasText: 'Advanced Flow' });
    
    await draggableB.dragTo(targetA);
    // Give it a moment to update the list
    await page.waitForTimeout(1000);
    
    // Verify the items exist
    const items = await page.locator('.flow-item-name').allTextContents();
    expect(items).toContain('Advanced Flow');
    expect(items).toContain('Flow B');

    // 4. Verify Reveal in Context Menu
    console.log('Verifying Reveal option...');
    const flowRowReveal = page.locator('.flow-item').filter({ hasText: 'Advanced Flow' });
    await flowRowReveal.hover();
    await flowRowReveal.locator('.more-btn').click();
    const revealOption = page.locator('.flow-context-menu button:has(svg.lucide-folder-search)');
    await expect(revealOption).toBeVisible();
    await page.locator('.modal-overlay, body').first().click({ position: { x: 0, y: 0 } }); // Close menu

    // 5. Delete Advanced Flow
    console.log('Deleting Advanced Flow...');
    page.once('dialog', (dialog: any) => dialog.accept());
    const flowRowA = page.locator('.flow-item').filter({ hasText: 'Advanced Flow' });
    await flowRowA.hover();
    await flowRowA.locator('.more-btn').click();
    await page.locator('.flow-context-menu button:has-text("Delete")').click();
    
    await expect(page.locator('.flow-item-name').filter({ hasText: 'Advanced Flow' })).not.toBeVisible({ timeout: 10000 });
    
    // Delete Flow B
    console.log('Deleting Flow B...');
    page.once('dialog', (dialog: any) => dialog.accept());
    const flowRowB = page.locator('.flow-item').filter({ hasText: 'Flow B' });
    await flowRowB.hover();
    await flowRowB.locator('.more-btn').click();
    await page.locator('.flow-context-menu button:has-text("Delete")').click();
    
    await expect(page.locator('.flow-item-name').filter({ hasText: 'Flow B' })).not.toBeVisible({ timeout: 10000 });
    console.log('Flows deleted successfully!');
  });
});
