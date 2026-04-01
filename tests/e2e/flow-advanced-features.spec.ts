import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Advanced Features — Environment & Completion', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    const userDataDir = join(__dirname, '../../test-output/user-data/flow-advanced-features');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock', '--disable-gpu'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('should respect flow-level environment and show completion panel', async () => {
    test.setTimeout(180000);

    // ── 1. Setup Environment ────────────────────────────────────────────────
    console.log('[E2E] Opening Environments...');
    await page.click('button[data-tooltip="Environments"]');
    await page.waitForSelector('.env-panel', { state: 'visible' });
    
    await page.click('button[data-tooltip="Add Environment"]', { force: true });
    
    const envItem = page.locator('.env-item').last();
    await envItem.waitFor({ state: 'visible' });
    await envItem.locator('button[data-tooltip="Rename"]').first().click({ force: true });
    const nameInput = envItem.locator('input.env-name-input');
    await nameInput.waitFor({ state: 'visible' });
    await nameInput.fill('Flow Env');
    await nameInput.press('Enter');
    
    await expect(envItem.locator('.env-name')).toHaveText('Flow Env', { timeout: 10000 });
    
    console.log('[E2E] Adding variable...');
    const isExpanded = await envItem.locator('.env-item-body').isVisible();
    if (!isExpanded) {
      await envItem.locator('.env-item-header').click();
      await page.waitForSelector('.env-item-body', { state: 'visible' });
    }
    await envItem.locator('button.kv-add').click();
    const firstRow = envItem.locator('.env-var-row').first();
    await firstRow.waitFor({ state: 'visible' });
    await firstRow.locator('.env-var-key').fill('base_url');
    await firstRow.locator('.env-var-value').fill('flow-val');
    
    await page.click('button:has-text("Save Changes")', { timeout: 3000 }).catch(() => {});
    
    console.log('[E2E] Verifying environment in global selector...');
    await page.waitForFunction(() => {
      const select = document.querySelector('.env-selector') as HTMLSelectElement;
      if (!select) return false;
      return Array.from(select.options).some(o => o.label === 'Flow Env');
    }, null, { timeout: 10000 });

    await page.click('button[data-tooltip="Environments"]');
    await page.waitForSelector('.env-panel', { state: 'hidden' });

    // ── 2. Setup Collection & Request ────────────────────────────────────────
    console.log('[E2E] Creating collection & request...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('.modal-body input', 'Test Collection');
    await page.click('button:has-text("Create Collection")');
    
    await page.click('.address-input .cm-content');
    await page.keyboard.type('http://localhost:1234/{{base_url}}');
    await page.click('.save-btn');
    await page.waitForSelector('.modal-content h3:has-text("Save Request")');
    await page.click('.collection-modal-item:has-text("Test Collection")');
    await page.click('.modal-footer button:has-text("OK")');

    // ── 3. Create Flow ───────────────────────────────────────────────────────
    console.log('[E2E] Creating flow...');
    await page.click('button[data-tooltip="Flow Runner"]');
    await page.waitForSelector('.flow-panel');
    await page.click('.flow-panel-actions button[title="New Flow"]');
    await page.click('.modal-content button:has-text("Create Flow")');
    await page.waitForSelector('.flow-canvas');

    // ── 4. Set Flow-level Environment ────────────────────────────────────────
    console.log('[E2E] Setting flow-level environment...');
    await page.click('.flow-controls button:has-text("settings")');
    await page.waitForSelector('.flow-settings-drawer', { state: 'visible' });
    
    // Explicitly target the select under "Environment" label in the drawer
    const envSelect = page.locator('.flow-settings-drawer .settings-field').filter({
      has: page.locator('label', { hasText: /^Environment$/ })
    }).locator('select');
    
    await envSelect.waitFor({ state: 'visible' });
    console.log('[E2E] Waiting for "Flow Env" option in settings select...');
    await expect(envSelect.locator('option')).toContainText(['Flow Env'], { timeout: 15000 });
    
    await envSelect.selectOption({ label: 'Flow Env' });
    await page.waitForTimeout(500);
    
    console.log('[E2E] Closing drawer...');
    await page.click('.flow-settings-drawer .drawer-header .icon-btn');
    await expect(page.locator('.flow-settings-drawer')).toBeHidden({ timeout: 10000 });

    // ── 5. Add Script Step & Verify Variable ────────────────────────────────
    console.log('[E2E] Adding script step...');
    await page.click('.btn-add-step');
    await page.click('.add-step-dropdown button:has-text("Script")');
    
    const scriptEditor = page.locator('.step-card .cm-content');
    await scriptEditor.waitFor({ state: 'visible' });
    await scriptEditor.click();
    await page.keyboard.type('const val = ultra.context.get("base_url"); if (val !== "flow-val") throw new Error("Wrong variable value: " + val);');
    
    // ── 6. Run Flow & Verify Completion Panel ────────────────────────────────
    console.log('[E2E] Running flow...');
    await page.click('.flow-controls button.run');
    
    const completionPanel = page.locator('.flow-completion-panel');
    await expect(completionPanel).toBeVisible({ timeout: 60000 });
    await expect(completionPanel.locator('.summary-hint')).toContainText('Flow finished');
    await expect(completionPanel.locator('.stat-item.success')).toContainText('1 passed');
    
    // ── 7. Test Reset from Panel ─────────────────────────────────────────────
    console.log('[E2E] Testing reset from panel...');
    page.once('dialog', async (dialog: any) => {
      await dialog.accept();
    });
    
    await completionPanel.locator('button:has-text("Clear & Reset")').click();
    await expect(completionPanel).toBeHidden({ timeout: 10000 });
    await expect(page.locator('.step-card .status-badge')).not.toBeVisible();
    
    console.log('✓ Advanced features test passed!');
  });
});
