import { test, expect, _electron as electron } from '@playwright/test';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Library Management Suite', () => {
  let electronApp: any;
  let window: any;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = join(tmpdir(), `ultrarpc-test-lib-${Date.now()}`);
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    mkdirSync(userDataDir, { recursive: true });

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    window.on('console', (msg: any) => console.log(`[BROWSER ${msg.type()}]: ${msg.text()}`));
    await window.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const ensurePanelOpen = async (tooltip: string, panelSelector: string) => {
    console.log(`Ensuring panel "${tooltip}" is open...`);
    const btn = window.locator(`button[data-tooltip="${tooltip}"]`).first();
    await btn.waitFor({ state: 'visible' });

    const startTime = Date.now();
    const timeout = 20000;

    while (Date.now() - startTime < timeout) {
      const isVisible = await window.locator(panelSelector).isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Panel "${tooltip}" is now VISIBLE.`);
        return;
      } else {
        console.log(`Clicking "${tooltip}" toggle...`);
        await btn.click({ force: true }).catch(() => { });
        await wait(2000);
      }
    }
    throw new Error(`Failed to open panel "${tooltip}" within ${timeout}ms`);
  };

  const openLibraryModal = async () => {
    await window.click('button[data-tooltip="Code Library"]');
    await expect(window.locator('.library-modal')).toBeVisible({ timeout: 10000 });
  };

  test('should support CRUD operations on scripts', async () => {
    test.setTimeout(120000);

    // 1. Add New Script
    const newScriptPath = join(userDataDir, 'new-lib.js');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any;
    }, newScriptPath);

    await openLibraryModal();
    console.log('Clicking New...');
    await window.click('button:has-text("New")');

    // Should appear in the list
    const libItem = window.locator('.library-item', { hasText: 'new-lib.js' });
    await expect(libItem).toBeVisible();
    await expect(libItem).toHaveClass(/selected/);

    // Verify default template
    await expect(window.locator('.library-editor .cm-content')).toContainText('ultra.lib');

    // 2. Link Existing Script
    const linkedScriptPath = join(userDataDir, 'linked-lib.js');
    writeFileSync(linkedScriptPath, 'ultra.lib.linked = () => "linked"', 'utf-8');

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, linkedScriptPath);

    console.log('Clicking Link Script...');
    await window.click('button:has-text("Link Script")');

    const linkedItem = window.locator('.library-item', { hasText: 'linked-lib.js' });
    await expect(linkedItem).toBeVisible();

    // 3. Edit and Save
    await linkedItem.click();
    await window.click('.library-editor .cm-content');
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('ultra.lib.updated = () => "updated"', { delay: 5 });

    console.log('Clicking Save...');
    await window.click('button.btn-primary:has-text("Save")');

    // Verify it was written to disk
    const onDisk = readFileSync(linkedScriptPath, 'utf-8');
    expect(onDisk).toBe('ultra.lib.updated = () => "updated"');

    // 4. Delete
    console.log('Deleting linked script...');
    await linkedItem.locator('.lib-delete-btn').click();
    await expect(linkedItem).not.toBeVisible();

    // Close modal
    await window.click('button:has-text("Close")');
    await expect(window.locator('.library-modal')).not.toBeVisible();
  });

  test('should execute scripts in pre-request and post-response', async () => {
    test.setTimeout(180000);

    // Setup: Create a library script
    const libPath = join(userDataDir, 'execution-test.js');
    writeFileSync(libPath, `
ultra.lib.test = (phase) => {
  ultra.env.set('ran_' + phase, 'yes');
};
    `.trim(), 'utf-8');

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, libPath);

    await openLibraryModal();
    await window.click('button:has-text("Link Script")');
    
    // Ensure it's enabled (it should be by default)
    const libItem = window.locator('.library-item', { hasText: 'execution-test.js' });
    await expect(libItem.locator('input[type="checkbox"]')).toBeChecked();

    await window.click('button:has-text("Close")');

    // Setup: Create an environment
    await ensurePanelOpen('Environments', '.env-panel');
    await wait(1000);
    console.log('Clicking Add Environment...');
    await window.click('button[data-tooltip="Add Environment"]', { force: true });
    await wait(2000);
    
    const newEnv = window.locator('.env-item', { hasText: 'New Environment' }).first();
    await newEnv.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Expanding environment...');
    await newEnv.click(); // Expand it
    await wait(1000);
    
    // 1. Pre-request execution
    console.log('Setting up request...');
    await window.click('.tab-add');
    await wait(1000);
    await window.click('.address-input .cm-content');
    await window.keyboard.type('https://httpbin.org/get');

    // Select the environment from the dropdown
    console.log('Selecting environment from dropdown...');
    const testEnvName = `LibTestEnv_${Date.now()}`;
    console.log(`Renaming environment to "${testEnvName}"...`);
    // Click Rename button (Edit2 icon) - wait for it to be visible first
    const envItem = window.locator('.env-item').filter({ hasText: 'New Environment' }).first();
    const renameBtn = envItem.locator('button[data-tooltip="Rename"]').first();
    await renameBtn.waitFor({ state: 'visible' });
    await renameBtn.click();

    // Now searching for the item in EDIT mode (it will have an input)
    const activeEnvItem = window.locator('.env-item').filter({ has: window.locator('.env-name-input') }).first();
    const envNameInput = activeEnvItem.locator('.env-name-input');
    await expect(envNameInput).toBeVisible();
    await envNameInput.fill(testEnvName);
    await envNameInput.press('Enter');
    await expect(envNameInput).not.toBeVisible();
    await wait(1000);

    // Select the environment from the dropdown
    console.log(`Selecting environment "${testEnvName}" from dropdown...`);
    const envOption = window.locator('.env-selector option').filter({ hasText: testEnvName }).first();
    await envOption.waitFor({ state: 'attached', timeout: 10000 });
    await window.selectOption('.env-selector', { label: testEnvName });
    
    // Also right click it in the sidebar to make it the absolute global active fallback
    const renamedEnvItem = window.locator('.env-item').filter({ hasText: testEnvName }).first();
    await renamedEnvItem.click({ button: 'right' });
    await wait(500);

    await window.click('button:has-text("Pre-request")');
    await window.waitForSelector('.script-editor');
    await wait(500);
    await window.click('.script-editor .cm-content');
    await window.keyboard.type('ultra.lib.test("pre");');

    // 2. Post-response execution
    await window.click('button:has-text("Post-response")');
    await window.waitForSelector('.script-editor');
    await wait(500);
    await window.click('.script-editor .cm-content');
    await window.keyboard.type('ultra.lib.test("post");');

    // Send request
    console.log('Sending request...');
    await window.click('.send-btn');
    await expect(window.locator('.response-status-badge')).toBeVisible({ timeout: 20000 });

    // Open Environments to verify
    await ensurePanelOpen('Environments', '.env-panel');
    await wait(1000);
    
    // Check env vars in UI
    console.log('Checking environment variables...');
    const rows = window.locator('.env-var-row');
    const rowCount = await rows.count();
    let foundPre = false;
    let foundPost = false;
    
    for (let i = 0; i < rowCount; i++) {
        const key = await rows.nth(i).locator('input.env-var-key').inputValue();
        if (key === 'ran_pre') {
            await expect(rows.nth(i).locator('input.env-var-value')).toHaveValue('yes');
            foundPre = true;
        }
        if (key === 'ran_post') {
            await expect(rows.nth(i).locator('input.env-var-value')).toHaveValue('yes');
            foundPost = true;
        }
    }
    expect(foundPre).toBe(true);
    expect(foundPost).toBe(true);
  });
});
