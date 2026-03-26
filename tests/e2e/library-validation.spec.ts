import { test, expect, _electron as electron } from '@playwright/test';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Library Validation Suite', () => {
  let electronApp: any;
  let window: any;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = join(tmpdir(), `ultrarpc-test-lib-val-${Date.now()}`);
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    mkdirSync(userDataDir, { recursive: true });

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  const openLibraryModal = async () => {
    await window.click('button[data-tooltip="Code Library"]');
    await expect(window.locator('.library-modal')).toBeVisible({ timeout: 10000 });
  };

  test('should validate a correct script', async () => {
    await openLibraryModal();
    
    // Create new script
    const scriptPath = join(userDataDir, 'val-success.js');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any;
    }, scriptPath);

    await window.click('button:has-text("New")');
    await expect(window.locator('.library-item', { hasText: 'val-success.js' })).toBeVisible();

    // Type correct code
    await window.click('.library-editor .cm-content');
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('ultra.lib.test = () => "ok";', { delay: 5 });

    // Click Validate
    await window.click('button:has-text("Validate")');

    // Check success banner
    const banner = window.locator('.validation-banner.success');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Script is syntactically valid');
    
    // Check button color class
    await expect(window.locator('button:has-text("Validate")')).toHaveClass(/val-success/);
  });

  test('should show error for invalid syntax', async () => {
    await openLibraryModal();
    
    // Create new script
    const scriptPath = join(userDataDir, 'val-error.js');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any;
    }, scriptPath);

    await window.click('button:has-text("New")');

    // Type invalid code
    await window.click('.library-editor .cm-content');
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('const x = ;', { delay: 5 });

    // Click Validate
    await window.click('button:has-text("Validate")');

    // Check error banner
    const banner = window.locator('.validation-banner.error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Validation Error');
    
    // Check button color class
    await expect(window.locator('button:has-text("Validate")')).toHaveClass(/val-error/);
  });

  test('should show warning for script not using ultra.lib', async () => {
    await openLibraryModal();
    
    // Create new script
    const scriptPath = join(userDataDir, 'val-warn.js');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any;
    }, scriptPath);

    await window.click('button:has-text("New")');

    // Type valid code but no ultra.lib
    await window.click('.library-editor .cm-content');
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('console.log("hello");', { delay: 5 });

    // Click Validate
    await window.click('button:has-text("Validate")');

    // Check error banner (it uses error styling for the lint warning)
    const banner = window.locator('.validation-banner.error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('does not seem to register any functions on "ultra.lib"');
  });

  test('should clear validation state when editing', async () => {
    await openLibraryModal();
    
    // Create and validate
    const scriptPath = join(userDataDir, 'val-clear.js');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any;
    }, scriptPath);

    await window.click('button:has-text("New")');
    await window.click('button:has-text("Validate")');
    await expect(window.locator('.validation-banner.success')).toBeVisible();

    // Type something
    await window.click('.library-editor .cm-content');
    await window.keyboard.type(' ');

    // Banner should disappear
    await expect(window.locator('.validation-banner')).not.toBeVisible();
    await expect(window.locator('button:has-text("Validate")')).not.toHaveClass(/val-success/);
  });
});
