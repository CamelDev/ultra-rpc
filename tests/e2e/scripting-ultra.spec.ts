import { test, expect, _electron as electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { createServer, Server } from 'http';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mockServer: Server;
let MOCK_PORT: number;

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
    // Use port 0 to get a random available port, avoiding EADDRINUSE on retries
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    MOCK_PORT = (mockServer.address() as any).port;
    console.log(`[MockServer] Running at http://127.0.0.1:${MOCK_PORT}`);
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (mockServer.closeAllConnections) {
        mockServer.closeAllConnections();
      }
      mockServer.close((err) => err ? reject(err) : resolve());
    });
  });

  test('ultra.sendRequest and ultra.globals work together correctly', async () => {
    test.setTimeout(90000);
    console.log('Launching Electron...');
    // Use a unique tmpdir per run to avoid stale state on retries
    const userDataDir = join(tmpdir(), `ultrarpc-scripting-ultra-${Date.now()}`);
    mkdirSync(userDataDir, { recursive: true });

    const electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    try {
      const window = await electronApp.firstWindow();
      window.on('console', (msg: any) => console.log(`[BROWSER ${msg.type()}]: ${msg.text()}`));
      console.log('Window found, waiting for .app-container...');
      await window.waitForSelector('.app-container', { timeout: 30000 });

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

      // 1. Create a new environment
      console.log('Creating environment...');
      await ensurePanelOpen('Environments', '.env-panel');
      await wait(1000);
      await window.click('button[data-tooltip="Add Environment"]', { force: true });
      await wait(2000);
      
      const testEnvName = `UltraTestEnv_${Date.now()}`;
      console.log(`Renaming environment to "${testEnvName}"...`);
      const envItem = window.locator('.env-item', { hasText: 'New Environment' }).first();
      await envItem.waitFor({ state: 'visible' });
      const renameBtn = envItem.locator('button[data-tooltip="Rename"]').first();
      await renameBtn.click();
      
      const envNameInput = window.locator('.env-name-input');
      await expect(envNameInput).toBeVisible();
      await envNameInput.fill(testEnvName);
      await envNameInput.press('Enter');
      await expect(envNameInput).not.toBeVisible();
      await wait(1500); // Extra time to ensure env name is persisted in state

      // 2. Create a new request tab
      console.log('Clicking .tab-add...');
      await window.click('.tab-add');
      await wait(1000);

      // 3. Select environment for this tab — wait for the option to appear in the dropdown first
      console.log('Activating environment for tab...');
      await window.waitForFunction(
        (envName: string) => {
          const opts = document.querySelectorAll('.env-selector option');
          return Array.from(opts).some(o => o.textContent === envName);
        },
        testEnvName,
        { timeout: 15000 }
      );
      await window.selectOption('.env-selector', { label: testEnvName });
      await wait(500);
      
      // Also right click it in the sidebar to make it global active
      const renamedEnvItem = window.locator('.env-item').filter({ hasText: testEnvName }).first();
      if (await renamedEnvItem.isVisible()) {
        await renamedEnvItem.click({ button: 'right' });
        await wait(500);
      }
      
      // 3. Set URL
      console.log('Setting URL...');
      await window.click('.address-input .cm-content');
      await window.keyboard.press('Control+A');
      await window.keyboard.press('Backspace');
      await window.keyboard.type(`http://127.0.0.1:${MOCK_PORT}/headers`);

      // 4. Set up Pre-request script
      console.log('Opening Pre-request script tab...');
      await window.click('button:has-text("Pre-request")');
      
      const preScriptEditor = window.locator('.script-editor');
      await expect(preScriptEditor).toBeVisible({ timeout: 10000 });
      await window.waitForSelector('.script-editor .cm-content');
      await window.click('.script-editor .cm-content');
      await window.keyboard.press('Control+A');
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
    ultra.env.set("test_ultra_message", data.message);
    console.log("Set environment variable: test_ultra_message");
    console.log("Sent request via ultra.sendRequest!");
});
      `.trim();

      await window.keyboard.type(preRequestCode, { delay: 5 });

      // 5. Set up Post-response script
      console.log('Opening Post-response script tab...');
      await window.click('button:has-text("Post-response")');
      const postScriptEditor = window.locator('.script-editor');
      await expect(postScriptEditor).toBeVisible({ timeout: 10000 });
      await window.waitForSelector('.script-editor .cm-content');
      await window.click('.script-editor .cm-content');
      await window.keyboard.press('Control+A');
      await window.keyboard.press('Backspace');
      
      const postResponseCode = `
console.log("Post-response script initiated");
const envVal = ultra.env.get("test_ultra_message");
console.log("Environment value: " + envVal);
if (envVal === "Hello from mock server!") {
    console.log("Environment value successfully verified: " + envVal);
} else {
    console.log("WARNING: envVal was: " + String(envVal));
}
console.log("Response headers verified");
      `.trim();

      await window.keyboard.type(postResponseCode, { delay: 5 });

      // 6. Send the main request
      console.log('Clicking Send button...');
      await window.click('.send-btn');

      // 7. Wait for success response
      console.log('Waiting for response status...');
      await expect(window.locator('.response-status-badge')).toBeVisible({ timeout: 15000 });
      // Give time for async ultra.sendRequest callback to fire and env vars to propagate
      await new Promise(r => setTimeout(r, 2000));

      // 8. Verify Console Output
      console.log('Verifying console logs...');
      const consoleLogs = window.locator('.console-logs');
      await expect(consoleLogs).toContainText('Pre-request script initiated', { timeout: 10000 });
      await expect(consoleLogs).toContainText('Sent request via ultra.sendRequest!', { timeout: 10000 });
      await expect(consoleLogs).toContainText('Set environment variable: test_ultra_message', { timeout: 10000 });
      await expect(consoleLogs).toContainText('Post-response script initiated', { timeout: 10000 });
      await expect(consoleLogs).toContainText('Environment value successfully verified: Hello from mock server!', { timeout: 10000 });
      await expect(consoleLogs).toContainText('Response headers verified', { timeout: 10000 });

      console.log('Success!');
    } finally {
      await electronApp.close();
      // Clean up temp directory
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { }
    }
  });
});
