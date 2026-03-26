import { test, expect, _electron as electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Script Validation Suite', () => {
  let electronApp: any;
  let window: any;

  test.beforeEach(async () => {
    const userDataDir = resolve(__dirname, '../../test-output/user-data/script-validation');
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /*
  test('Library Modal validation works', async () => {
    ...
  });
  */

  test('Pre-request script validation works', async () => {
    // Create new tab
    await window.click('.tab-add');
    await wait(500);

    // Open Pre-request tab
    await window.click('button:has-text("Pre-request")');
    
    // Enter invalid JS
    const editor = window.locator('.script-section .cm-content').first();
    await editor.click();
    await window.keyboard.type('function {', { delay: 10 });

    // Click Validate
    await window.click('.script-section button:has-text("Validate")');

    // Expect error banner
    const banner = window.locator('.validation-banner').first();
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/error/);

    // Enter valid JS
    await editor.click();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('console.log("hello");', { delay: 10 });

    // Click Validate
    await window.click('.script-section button:has-text("Validate")');

    // Expect success banner
    await expect(banner).toHaveClass(/success/);
  });

  test('Post-response script validation works', async () => {
    // Create new tab
    await window.click('.tab-add');
    await wait(500);

    // Open Post-response tab
    await window.click('button:has-text("Post-response")');
    
    // Enter invalid JS
    const editor = window.locator('.script-section .cm-content').first();
    await editor.click();
    await window.keyboard.type('import x from "y";', { delay: 10 }); // Import not allowed in new Function

    // Click Validate
    await window.click('.script-section button:has-text("Validate")');

    // Expect error banner
    const banner = window.locator('.validation-banner').first();
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/error/);

    // Enter valid JS
    await editor.click();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('ultra.expect(1).toBe(1);', { delay: 10 });

    // Click Validate
    await window.click('.script-section button:has-text("Validate")');

    // Expect success banner
    await expect(banner).toHaveClass(/success/);
  });
});
