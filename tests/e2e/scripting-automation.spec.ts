import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockRestServer } from '../mocks/rest-server';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Scripting & Automation Suite', () => {
  let mockServer: MockRestServer;
  let electronApp: any;
  let window: any;
  const MOCK_PORT = 3343;
  const GRPC_PORT = 50059;

  test.beforeAll(async () => {
    mockServer = new MockRestServer(MOCK_PORT);
    await mockServer.start();

    const userDataDir = join(__dirname, '../../test-output/user-data/scripting');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 15000 });
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
    if (mockServer) await mockServer.stop();
  });

  test('Pre-request script should inject value into environment and URL', async () => {
    // 1. Create an environment
    await window.click('button[data-tooltip="Environments"]');
    await window.click('button[data-tooltip="Add Environment"]');
    await window.click('button[data-tooltip="Environments"]'); // Close panel
    
    // 2. Select it as active in the header
    await window.selectOption('.env-selector', { label: 'New Environment' });

    // 3. Set URL with a variable placeholder
    const addressInput = window.locator('.address-input .cm-content');
    await addressInput.click();
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');
    await addressInput.fill(`${mockServer.url}/{{path_var}}`);

    // 4. Go to Pre-request tab and add script
    await window.click('button:has-text("Pre-request")');
    const scriptEditor = window.locator('.script-editor .cm-content');
    await scriptEditor.click();
    await window.keyboard.type('ultra.env.set("path_var", "headers");');
    await window.keyboard.type('\nconsole.log("Setting path_var to headers");');

    // 5. Send request
    await window.click('button:has-text("Send")');

    // 6. Verify response (mock server /headers returns { headers: ... })
    const statusBadge = window.locator('.response-status-badge');
    await expect(statusBadge).toContainText('200 OK', { timeout: 10000 });
    
    const responseBody = window.locator('.response-viewer .cm-content');
    await expect(responseBody).toContainText('"method": "GET"', { timeout: 5000 });

    // 7. Verify Console Output
    const consoleLogs = window.locator('.console-logs');
    await expect(consoleLogs).toContainText('Setting path_var to headers');
    await expect(consoleLogs).toContainText('LOG: Set env variable: path_var');
  });

  test('Post-response script should extract value and run assertions', async () => {
    // 1. Create a collection to enable collection variables
    await window.click('button[data-tooltip="New Collection"]');
    await window.fill('.modal-body input', 'script-test-coll');
    await window.click('button:has-text("Create Collection")');
    
    // 2. Set URL to /data (which returns JSON with "status": "success")
    const addressInput = window.locator('.address-input .cm-content');
    await addressInput.click();
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');
    await addressInput.fill(`${mockServer.url}/data`);

    // 3. Link request to collection (save it)
    await window.click('.save-btn');
    await window.click('.collection-modal-item:has-text("script-test-coll")');
    await window.click('.modal-footer button:has-text("OK")');

    // 4. Add Post-response script
    await window.click('button:has-text("Post-response")');
    const scriptEditor = window.locator('.script-editor .cm-content');
    await scriptEditor.click();
    await window.keyboard.type('ultra.test("Status is 200", () => {');
    await window.keyboard.type('\n  ultra.expect(ultra.response.status).toBe(200);');
    await window.keyboard.type('\n});');
    await window.keyboard.type('\nultra.test("Body has success", () => {');
    await window.keyboard.type('\n  ultra.expect(ultra.response.body.status).toBe("success");');
    await window.keyboard.type('\n});');
    await window.keyboard.type('\nultra.collection.set("last_status", ultra.response.body.status);');

    // 5. Send request
    await window.click('button:has-text("Send")');

    // 6. Verify Console Output for tests
    const consoleLogs = window.locator('.console-logs');
    await expect(consoleLogs).toContainText('TEST PASS: Status is 200', { timeout: 10000 });
    await expect(consoleLogs).toContainText('TEST PASS: Body has success', { timeout: 10000 });
    await expect(consoleLogs).toContainText('LOG: Set collection variable: last_status', { timeout: 10000 });

    // 7. Verify collection variable was updated (check modal)
    await window.click('.tree-node:has-text("script-test-coll") .coll-action-btn');
    await window.waitForSelector('.coll-context-menu', { timeout: 5000 });
    await window.click('.coll-context-menu button:has-text("Variables")');
    
    const varRow = window.locator('.kv-row').first();
    await expect(varRow.locator('.kv-key')).toContainText('last_status', { timeout: 10000 });
    await expect(varRow.locator('.kv-value')).toContainText('success', { timeout: 10000 });
  });
});
