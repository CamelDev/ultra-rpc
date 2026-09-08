import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('JSON Formatting with Variables', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    const userDataDir = join(__dirname, '../../test-output/user-data/json-format');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should format JSON with unquoted interpolated variables', async () => {
    // 1. Go to Body tab
    const configTab = window.locator('.config-tab:has-text("Body")');
    if (!(await configTab.isVisible())) {
      await window.click('button:has-text("New REST Request")');
    }
    await window.waitForSelector('.config-tab', { timeout: 10000 });
    await window.click('.config-tab:has-text("Body")');
    
    // 2. Set body type to JSON
    const jsonBtn = window.locator('.body-type-btn:has-text("JSON")');
    await jsonBtn.waitFor({ state: 'visible', timeout: 5000 });
    await jsonBtn.click();
    
    // Verify it's active
    await expect(jsonBtn).toHaveClass(/body-type-active/, { timeout: 5000 });
    
    // Debug: log all buttons in the body-editor
    const buttons = await window.evaluate(() => {
      return Array.from(document.querySelectorAll('.body-editor button')).map(b => (b as HTMLElement).innerText.trim());
    });
    console.log('Visible buttons in body-editor:', buttons);
    
    // 3. Input messy JSON with unquoted variables
    const messyJson = '{"departure_date": {"year": {{search_year}}, "month": {{search_month}}}}';
    
    const editor = window.locator('.body-textarea .cm-content');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await editor.fill(messyJson);
    
    // 4. Click Format button
    // Wait for the button to be visible since it's conditional
    const formatBtn = window.locator('button:has-text("Format")');
    await formatBtn.waitFor({ state: 'visible', timeout: 5000 });
    await formatBtn.click();
    
    // 5. Verify formatted content
    await expect(editor).toContainText('"year": {{search_year}}');
    await expect(editor).toContainText('"month": {{search_month}}');
    await expect(editor).toContainText('  "departure_date": {');
  });
  
  test('should preserve existing quoted variables', async () => {
    const jsonWithQuotedVar = '{"host": "{{search_host}}", "port": 8080}';
    
    // Ensure we are in Body/JSON
    const configTab2 = window.locator('.config-tab:has-text("Body")');
    if (!(await configTab2.isVisible())) {
      await window.click('button:has-text("New REST Request")');
    }
    await window.waitForSelector('.config-tab', { timeout: 10000 });
    await window.click('.config-tab:has-text("Body")');
    await window.waitForSelector('.body-type-btn', { timeout: 5000 });
    await window.click('.body-type-btn:has-text("JSON")');

    const editor = window.locator('.body-textarea .cm-content');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await editor.fill(jsonWithQuotedVar);
    
    await window.waitForSelector('button:has-text("Format")', { timeout: 5000 });
    await window.click('button:has-text("Format")');
    
    await expect(editor).toContainText('"host": "{{search_host}}"');
    await expect(editor).toContainText('"port": 8080');
  });

  test('should handle complex nested structures with variables', async () => {
     const complexJson = `
 {
  "origin_destination_criteria": [
     {
       "origin_location_code": "GIG",
       "departure_date": {
         "year": {{search_year}}
       }
     }
  ]
 }`;
     
     // Ensure we are in Body/JSON
     const configTab3 = window.locator('.config-tab:has-text("Body")');
     if (!(await configTab3.isVisible())) {
       await window.click('button:has-text("New REST Request")');
     }
     await window.waitForSelector('.config-tab', { timeout: 10000 });
     await window.click('.config-tab:has-text("Body")');
     await window.waitForSelector('.body-type-btn', { timeout: 5000 });
     await window.click('.body-type-btn:has-text("JSON")');

     const editor = window.locator('.body-textarea .cm-content');
     await editor.click();
     await editor.fill(complexJson);
     
     await window.waitForSelector('button:has-text("Format")', { timeout: 5000 });
     await window.click('button:has-text("Format")');
     
     await expect(editor).toContainText('"year": {{search_year}}');
     await expect(async () => {
       const formattedContent = await editor.innerText();
       expect(formattedContent).toMatch(/\s{6}"year": {{search_year}}/);
     }).toPass();
  });

  test('should allow switching to TEXT body type and typing freeform text', async () => {
    const configTab = window.locator('.config-tab:has-text("Body")');
    if (!(await configTab.isVisible())) {
      await window.click('button:has-text("New REST Request")');
    }
    await window.waitForSelector('.config-tab', { timeout: 10000 });
    await window.click('.config-tab:has-text("Body")');

    const textBtn = window.locator('.body-type-btn:has-text("TEXT")');
    await textBtn.waitFor({ state: 'visible', timeout: 5000 });
    await textBtn.click();

    await expect(textBtn).toHaveClass(/body-type-active/, { timeout: 5000 });

    const editor = window.locator('.body-textarea .cm-content');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await editor.fill('hello world plain text body');

    await expect(editor).toContainText('hello world plain text body');
    await expect(textBtn).toHaveClass(/body-type-active/);
  });

  test('should not trigger change detection when switching body types without edits', async () => {
    await window.click('button.tab-add');
    await window.waitForTimeout(300);

    const activeTab = window.locator('.tab-item.tab-active');
    await expect(activeTab).toHaveAttribute('data-dirty', 'false');

    await window.click('.config-tab:has-text("Body")');

    // Switch to TEXT
    const textBtn = window.locator('.body-type-btn:has-text("TEXT")');
    await textBtn.click();
    await expect(textBtn).toHaveClass(/body-type-active/);
    await expect(activeTab).toHaveAttribute('data-dirty', 'false');

    // Switch to NONE
    const noneBtn = window.locator('.body-type-btn:has-text("NONE")');
    await noneBtn.click();
    await expect(noneBtn).toHaveClass(/body-type-active/);
    await expect(activeTab).toHaveAttribute('data-dirty', 'false');

    // Switch to JSON
    const jsonBtn = window.locator('.body-type-btn:has-text("JSON")');
    await jsonBtn.click();
    await expect(jsonBtn).toHaveClass(/body-type-active/);
    await expect(activeTab).toHaveAttribute('data-dirty', 'false');
  });
});

