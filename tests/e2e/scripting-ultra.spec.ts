import { test, expect, _electron as electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { createServer, Server } from 'http';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_PORT = 3339;
let mockServer: Server;

test.describe('Ultra Scripting Suite', () => {
  test.beforeAll(async () => {
    mockServer = createServer((req, res) => {
      console.log(`[MockServer] ${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Mock-Header', 'Ultra-Test');
      
      if (req.url === '/data') {
        res.end(JSON.stringify({ message: "Hello from mock server!" }));
      } else {
        res.end(JSON.stringify({ status: "ok", headers: req.headers }));
      }
    });
    mockServer.listen(MOCK_PORT);
    console.log(`[MockServer] Running at http://127.0.0.1:${MOCK_PORT}`);
  });

  test.afterAll(async () => {
    if (mockServer.closeAllConnections) {
      mockServer.closeAllConnections();
    }
    mockServer.close();
  });

  test('ultra.sendRequest and ultra.globals work together correctly', async () => {
    test.setTimeout(60000);
    console.log('Launching Electron...');
    const userDataDir = resolve(__dirname, '../../test-output/user-data/scripting-ultra');
    const electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    const window = await electronApp.firstWindow();
    console.log('Window found, waiting for .app-container...');
    await window.waitForSelector('.app-container', { timeout: 15000 });

    // 1. Create a new request
    console.log('Clicking .tab-add...');
    await window.click('.tab-add');
    
    // 2. Set URL
    console.log('Setting URL...');
    await window.click('.address-input .cm-content');
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type(`http://127.0.0.1:${MOCK_PORT}/headers`);

    // 3. Set up Pre-request script
    console.log('Opening Pre-request script tab...');
    await window.click('button:has-text("Pre-request")');
    
    const preScriptEditor = window.locator('.script-editor');
    await expect(preScriptEditor).toBeVisible({ timeout: 10000 });
    await window.click('.script-editor .cm-content');
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');

    const preRequestCode = `
console.log("Pre-request script initiated");
const authRequest = {
    url: 'http://127.0.0.1:${MOCK_PORT}/data',
    method: 'GET'
};

ultra.sendRequest(authRequest, (err, res) => {
    if (err) {
        console.error("Error in ultra.sendRequest:", err);
        return;
    }
    const data = res.json();
    ultra.globals.set("test_ultra_message", data.message);
    console.log("Set global variable: test_ultra_message");
    console.log("Sent request via ultra.sendRequest!");
});
    `.trim();

    await window.keyboard.type(preRequestCode, { delay: 5 });

    // 4. Set up Post-response script
    console.log('Opening Post-response script tab...');
    await window.click('button:has-text("Post-response")');
    const postScriptEditor = window.locator('.script-editor');
    await expect(postScriptEditor).toBeVisible({ timeout: 10000 });
    await window.click('.script-editor .cm-content');
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');
    
    const postResponseCode = `
console.log("Post-response script initiated");
const globalVal = ultra.globals.get("test_ultra_message");
ultra.expect(globalVal).toBe("Hello from mock server!");
console.log("Global value successfully verified: " + globalVal);

const headers = ultra.response.body.headers;
ultra.expect(headers.host).toBe("127.0.0.1:${MOCK_PORT}");
console.log("Response headers verified");
    `.trim();

    await window.keyboard.type(postResponseCode, { delay: 5 });

    // 5. Send the main request
    console.log('Clicking Send button...');
    await window.click('.send-btn');

    // 6. Wait for success response
    console.log('Waiting for response status...');
    await expect(window.locator('.response-status-badge')).toBeVisible({ timeout: 10000 });

    // 7. Verify Console Output and variable persistence
    console.log('Verifying console logs...');
    const consoleLogs = window.locator('.console-logs');
    await expect(consoleLogs).toContainText('Pre-request script initiated');
    await expect(consoleLogs).toContainText('Sent request via ultra.sendRequest!');
    await expect(consoleLogs).toContainText('Set global variable: test_ultra_message');
    await expect(consoleLogs).toContainText('Post-response script initiated');
    await expect(consoleLogs).toContainText('Global value successfully verified: Hello from mock server!');
    await expect(consoleLogs).toContainText('Response headers verified');

    console.log('Success!');
    await electronApp.close();
  });
});
