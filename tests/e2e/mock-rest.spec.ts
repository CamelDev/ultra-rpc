import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockRestServer } from '../mocks/rest-server';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mockServer: MockRestServer;
const MOCK_PORT = 3333;
let electronApp: any;
let window: any;

test.beforeAll(async () => {
  mockServer = new MockRestServer(MOCK_PORT);
  await mockServer.start();

  const userDataDir = join(__dirname, '../../test-user-data-mock');
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log('Launching Electron...');
  electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
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

test('Should hit local REST mock server and get response', async () => {
  // 1. Set URL to mock server
  const mockUrl = `${mockServer.url}/data`;
  console.log(`Setting URL to ${mockUrl}`);
  
  const addressInput = window.locator('.address-input .cm-content');
  await addressInput.click();
  await window.keyboard.press('Meta+A');
  await window.keyboard.press('Backspace');
  await addressInput.fill(mockUrl);

  // 2. Click Send
  console.log('Clicking Send...');
  const sendBtn = window.locator('button:has-text("Send")');
  await sendBtn.click();

  // 3. Verify Response status
  console.log('Waiting for response...');
  const statusBadge = window.locator('.response-status-badge');
  await expect(statusBadge).toContainText('200 OK', { timeout: 10000 });
  
  // 4. Verify Response body content
  console.log('Verifying response body...');
  const responseBody = window.locator('.response-viewer .cm-content');
  await expect(responseBody).toContainText('Hello from mock server!', { timeout: 5000 });
  await expect(responseBody).toContainText('success', { timeout: 5000 });

  console.log('Test passed successfully!');
});
