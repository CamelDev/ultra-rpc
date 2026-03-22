import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockRestServer } from '../mocks/rest-server';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mockServer: MockRestServer;
const MOCK_PORT = 3340;
let electronApp: any;
let window: any;

test.beforeAll(async () => {
  mockServer = new MockRestServer(MOCK_PORT);
  await mockServer.start();

  const userDataDir = join(__dirname, '../../test-output/user-data/timeout');
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log('Launching Electron...');
  electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  console.log('App launched, waiting for window...');
  window = await electronApp.firstWindow();
  await window.waitForSelector('.app-container', { timeout: 15000 });
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  if (mockServer) {
    await mockServer.stop();
  }
});

test('REST Request Timeout - Should fail when timeout is too low', async () => {
  const slowUrl = `${mockServer.url}/slow?delay=2000`;
  
  // 1. Set URL
  const addressInput = window.locator('.address-input .cm-content');
  await addressInput.click();
  await window.keyboard.press('Meta+A');
  await window.keyboard.press('Backspace');
  await addressInput.fill(slowUrl);

  // 2. Go to Options tab and set low timeout
  await window.click('button.config-tab:has-text("Options")');
  const timeoutInput = window.locator('input[type="number"][placeholder*="Default"]');
  await timeoutInput.click({ clickCount: 3 });
  await timeoutInput.type('500');

  // 3. Click Send
  await window.click('button:has-text("Send")');

  // 4. Verify Error message
  const errorPane = window.locator('.response-error');
  await expect(errorPane).toContainText('Request timed out after 500ms', { timeout: 10000 });
});

test('REST Request Timeout - Should succeed when timeout is high enough', async () => {
  const slowUrl = `${mockServer.url}/slow?delay=1000`;
  
  // 1. Set URL (already set from previous test but let's be explicit)
  const addressInput = window.locator('.address-input .cm-content');
  await addressInput.click();
  await window.keyboard.press('Meta+A');
  await window.keyboard.press('Backspace');
  await addressInput.fill(slowUrl);

  // 2. Go to Options tab and set high timeout
  await window.click('button.config-tab:has-text("Options")');
  const timeoutInput = window.locator('input[type="number"][placeholder*="Default"]');
  await timeoutInput.click({ clickCount: 3 });
  await timeoutInput.type('3000');

  // 3. Click Send
  await window.click('button:has-text("Send")');

  // 4. Verify Success
  const statusBadge = window.locator('.response-status-badge');
  await expect(statusBadge).toContainText('200 OK', { timeout: 10000 });
  
  const responseBody = window.locator('.response-viewer .cm-content');
  await expect(responseBody).toContainText('"delayed": 1000', { timeout: 5000 });
});
