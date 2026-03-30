import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Panel Advanced', () => {
  let electronApp: any;
  let page: any;
  const userDataDir = join(__dirname, '../../test-output/user-data/flow-panel-advanced');

  test.beforeAll(async () => {
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ULTRA_TEST_USER_DATA: userDataDir
      }
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should support cloning, exporting, and deleting flows', async () => {
    test.setTimeout(60000);
    
    // 1. Create a collection first (required for flows)
    console.log('Creating collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input');
    await page.fill('.modal-body input', 'advanced-flow-coll');
    await page.click('button:has-text("Create Collection")');
    await expect(page.locator('.tree-node-name').filter({ hasText: /^advanced-flow-coll$/ })).toBeVisible({ timeout: 15000 });

    // 2. Open Flows panel and Create a Flow
    console.log('Opening Flow Runner panel...');
    await page.click('button[data-tooltip="Flow Runner"]');
    
    // Click New Flow button in the flow panel header
    const newFlowBtn = page.locator('.flow-panel-actions button[data-tooltip="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 15000 });
    console.log('Creating first flow...');
    await newFlowBtn.click();
    
    // Wait for modal and confirm
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.fill('.modal-body input', 'Advanced Flow');
    await page.click('button:has-text("Create Flow")');

    // Wait for canvas to load
    await page.waitForSelector('.flow-name-input', { timeout: 10000 });

    // 3. Verify Flow Panel has the flow
    console.log('Verifying flow is created in the panel...');
    const flowItem = page.locator('.flow-item-name').filter({ hasText: 'Advanced Flow' });
    await expect(flowItem).toBeVisible({ timeout: 10000 });

    // 4. Test Cloning
    console.log('Cloning the flow...');
    const flowItemRow = page.locator('.flow-item').first();
    await flowItemRow.hover();
    await flowItemRow.locator('.more-btn').click();
    const cloneBtn = page.locator('.flow-context-menu button:has-text("Clone")');
    await expect(cloneBtn).toBeVisible({ timeout: 5000 });
    await cloneBtn.click();
    
    // Wait for the clone modal and click Clone
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-footer button:has-text("Clone Flow")');
    
    // Wait for the clone to be visible.
    const stringCloneMatcher = page.locator('.flow-item-name').filter({ hasText: /copy/i });
    await expect(stringCloneMatcher).toBeVisible({ timeout: 15000 });
    console.log('Flow cloned successfully!');

    // 5. Test Exporting Flow
    console.log('Testing Export...');
    const cloneItem = page.locator('.flow-item').filter({ hasText: /copy/i });
    await cloneItem.hover();
    await cloneItem.locator('.more-btn').click();
    const exportBtn = page.locator('.flow-context-menu button:has-text("Export")');
    await expect(exportBtn).toBeVisible({ timeout: 5000 });
    await exportBtn.click();
    // Export doesn't show a modal, it triggers a save dialog.
    // In E2E, we mainly verify the IPC call or just that the button was clickable.
    
    // 6. Test Deleting Flow
    console.log('Deleting cloned flow...');
    await cloneItem.hover();
    await cloneItem.locator('.more-btn').click();
    const deleteBtn = page.locator('.flow-context-menu button:has-text("Delete")');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    page.once('dialog', (dialog: any) => dialog.accept());
    await deleteBtn.click();
    
    // Wait for the item to disappear
    await expect(cloneItem).toBeHidden({ timeout: 10000 });
    console.log('Flow deleted successfully!');
  });
});
