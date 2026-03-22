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
    
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+A`);
    await window.keyboard.press('Backspace');
    await window.keyboard.type(messyJson);
    
    // 4. Click Format
    // Wait for the button to be visible since it's conditional
    const formatBtn = window.locator('button:has-text("Format")');
    await formatBtn.waitFor({ state: 'visible', timeout: 5000 });
    await formatBtn.click();
    
    // 5. Verify formatted content
    await window.waitForTimeout(1000); // Wait for state update
    const formattedContent = await editor.innerText();
    
    expect(formattedContent).toContain('"year": {{search_year}}');
    expect(formattedContent).toContain('"month": {{search_month}}');
    expect(formattedContent).toContain('  "departure_date": {');
  });
  
  test('should preserve existing quoted variables', async () => {
    const jsonWithQuotedVar = '{"host": "{{search_host}}", "port": 8080}';
    
    // Ensure we are in Body/JSON
    await window.waitForSelector('.config-tab', { timeout: 10000 });
    await window.click('.config-tab:has-text("Body")');
    await window.waitForSelector('.body-type-btn', { timeout: 5000 });
    await window.click('.body-type-btn:has-text("JSON")');

    const editor = window.locator('.body-textarea .cm-content');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+A`);
    await window.keyboard.press('Backspace');
    await window.keyboard.type(jsonWithQuotedVar);
    
    await window.waitForSelector('button:has-text("Format")', { timeout: 5000 });
    await window.click('button:has-text("Format")');
    
    const formattedContent = await editor.innerText();
    expect(formattedContent).toContain('"host": "{{search_host}}"');
    expect(formattedContent).toContain('"port": 8080');
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
     await window.waitForSelector('.config-tab', { timeout: 10000 });
     await window.click('.config-tab:has-text("Body")');
     await window.waitForSelector('.body-type-btn', { timeout: 5000 });
     await window.click('.body-type-btn:has-text("JSON")');

     const editor = window.locator('.body-textarea .cm-content');
     await expect(editor).toBeVisible({ timeout: 5000 });
     await editor.click();
     
     const isMac = process.platform === 'darwin';
     const modifier = isMac ? 'Meta' : 'Control';
     await window.keyboard.press(`${modifier}+A`);
     await window.keyboard.press('Backspace');
     await window.keyboard.type(complexJson);
     
     await window.waitForSelector('button:has-text("Format")', { timeout: 5000 });
     await window.click('button:has-text("Format")');
     
     const formattedContent = await editor.innerText();
     expect(formattedContent).toContain('"year": {{search_year}}');
     // Verify "year" is double-indented (6 spaces)
     expect(formattedContent).toMatch(/\s{6}"year": {{search_year}}/);
  });
});
