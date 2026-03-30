import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Reset — Manual Variables', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    const userDataDir = join(__dirname, '../../test-output/user-data/flow-reset');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    page.on('console', (msg: any) => console.log(`[APP] ${msg.text()}`));
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('reset preserves manually-added baseline variables and shows confirmation dialog', async () => {
    test.setTimeout(60000);

    // ── 1. Create a collection (required to enable "New Flow") ───────────────
    console.log('Creating collection...');
    await page.click('button[data-tooltip="New Collection"]');
    await page.waitForSelector('.modal-body input');
    await page.fill('.modal-body input', 'Reset Test Collection');
    await page.click('button:has-text("Create Collection")');
    await expect(
      page.locator('.tree-node-name').filter({ hasText: /^Reset Test Collection$/ })
    ).toBeVisible({ timeout: 15000 });

    // ── 2. Open Flow Runner and create a new flow ────────────────────────────
    console.log('Opening Flow Runner...');
    await page.click('button[data-tooltip="Flow Runner"]');
    await page.waitForSelector('.flow-panel');

    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 15000 });
    await newFlowBtn.click();

    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('.modal-content button:has-text("Create Flow")');

    console.log('Waiting for Flow Canvas...');
    await page.waitForSelector('.flow-canvas', { timeout: 15000 });
    await page.waitForTimeout(500);

    // ── 3. Open Flow Settings drawer ─────────────────────────────────────────
    console.log('Opening settings drawer...');
    const settingsBtn = page.locator('.flow-controls button:has-text("settings")');
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });
    await settingsBtn.click();

    await page.waitForSelector('.flow-settings-drawer', { timeout: 10000 });

    // ── 4. Add a variable manually via the KV editor ─────────────────────────
    // The Variable Store section starts empty (recordToKV({}) returns []).
    // Click "+ Add" to create the first row.
    console.log('Adding variable manually...');
    const drawerLocator = page.locator('.flow-settings-drawer');
    const kvSection = drawerLocator.locator('.settings-section').filter({ hasText: 'Variable Store' });

    const addRowBtn = kvSection.locator('button.kv-add');
    await expect(addRowBtn).toBeVisible({ timeout: 5000 });
    await addRowBtn.click();

    // The KV editor uses CodeMirror — target .cm-content inside each kv-input div.
    // After clicking Add, one .kv-row should be present.
    const firstRow = kvSection.locator('.kv-row').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    const keyEditor = firstRow.locator('.kv-key .cm-content');
    const valueEditor = firstRow.locator('.kv-value .cm-content');

    await expect(keyEditor).toBeVisible({ timeout: 5000 });
    await keyEditor.fill('my_var');

    await expect(valueEditor).toBeVisible({ timeout: 5000 });
    await valueEditor.fill('hello');

    // ── 5. Apply settings (auto-saves now, just close drawer) ───────────────
    console.log('Closing settings drawer...');
    await page.locator('.drawer-header .icon-btn').click();
    await expect(page.locator('.flow-settings-drawer')).not.toBeVisible({ timeout: 5000 });

    // ── 6. Verify the variable persisted (re-open drawer) ────────────────────
    console.log('Verifying variable persisted...');
    await settingsBtn.click();
    await page.waitForSelector('.flow-settings-drawer', { timeout: 10000 });

    // There should be a row whose key editor contains 'my_var'
    const persistedRow = page.locator('.flow-settings-drawer .kv-row').filter({
      has: page.locator('.kv-key .cm-content', { hasText: 'my_var' })
    });
    await expect(persistedRow).toBeVisible({ timeout: 5000 });

    // Close drawer
    await page.locator('.drawer-header .icon-btn').click();
    await expect(page.locator('.flow-settings-drawer')).not.toBeVisible({ timeout: 5000 });

    // ── 7. Hit Reset — confirmation dialog MUST appear and be accepted ────────
    console.log('Clicking Reset...');
    const resetBtn = page.locator('button.reset-btn');
    await expect(resetBtn).toBeVisible({ timeout: 5000 });

    // Register the dialog handler BEFORE clicking reset
    const dialogPromise = new Promise<void>((resolve, reject) => {
      page.once('dialog', async (dialog: any) => {
        console.log(`Dialog: type=${dialog.type()}, msg="${dialog.message()}"`);
        try {
          expect(dialog.type()).toBe('confirm');
          await dialog.accept();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await resetBtn.click();
    await dialogPromise; // wait for dialog to be accepted

    // Small settle time for state propagation
    await page.waitForTimeout(500);

    // ── 8. Acceptance criteria ────────────────────────────────────────────────
    // a) Context variables are NOT empty (they are baseline) — re-open drawer to verify
    console.log('Verifying variables preserved in the drawer...');
    await settingsBtn.click();
    await page.waitForSelector('.flow-settings-drawer', { timeout: 10000 });

    // Row should still contain 'my_var' because it's baseline
    const preservedRow = page.locator('.flow-settings-drawer .kv-row').filter({
      has: page.locator('.kv-key .cm-content', { hasText: 'my_var' })
    });
    await expect(preservedRow).toBeVisible({ timeout: 5000 });

    // b) The drawer should still show the baseline variable row
    const allRows = page.locator('.flow-settings-drawer .kv-row');
    const keyContent = await allRows.nth(0).locator('.kv-key .cm-content').textContent();
    expect(keyContent?.trim() ?? '').toBe('my_var');

    console.log('✓ Reset test passed — baseline variables are preserved after reset!');
  });
});
