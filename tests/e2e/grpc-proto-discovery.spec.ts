import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('Should discover services via Proto File in modal and sync URL', async () => {
  const userDataDir = join(__dirname, '../../test-user-data-grpc-proto-discovery');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.app-container');

  console.log('Switching to gRPC mode...');
  await window.click('button.type-btn:has-text("gRPC")');
  await window.waitForTimeout(500); // Wait for UI transition

  console.log('Opening Discovery Modal...');
  const discoverBtn = window.locator('button.btn-primary:has-text("Discover")');
  await expect(discoverBtn).toBeVisible({ timeout: 10000 });
  await discoverBtn.click();

  console.log('Verifying Modal is visible...');
  const modal = window.locator('.modal-content');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await window.screenshot({ path: join(tmpdir(), 'ultrarpc-modal-opened.png') });
  await expect(modal).toContainText('gRPC Service Discovery');

  console.log('Changing Host in Modal...');
  // Ensure we target the input INSIDE the modal specifically
  const modalHostInput = modal.locator('input.address-input');
  await modalHostInput.click();
  await modalHostInput.fill('acme-corp.test:8443');

  console.log('Switching to Proto File mode...');
  const protoModeBtn = modal.locator('.reflect-mode-btn:has-text("Proto File")');
  await protoModeBtn.click();
  await expect(protoModeBtn).toHaveClass(/active/);

  console.log('Entering Proto Path...');
  const protoPath = join(__dirname, '../mocks/test.proto');
  const protoInput = modal.locator('.reflect-proto-input input');
  await protoInput.fill(protoPath);

  console.log('Clicking Discover Services in Modal...');
  await modal.locator('button.reflect-discover-btn').click();

  console.log('Waiting for GreetingService...');
  const serviceBtn = modal.locator('.reflect-service-btn').filter({ hasText: 'GreetingService' });
  await expect(serviceBtn).toBeVisible({ timeout: 10000 });
  await serviceBtn.click();
  await window.waitForTimeout(500); // Wait for expansion animation

  console.log('Selecting SayHello method...');
  const methodBtn = modal.locator('.reflect-method-btn').filter({ hasText: 'SayHello' }).first();
  await expect(methodBtn).toBeVisible({ timeout: 10000 });
  await methodBtn.click();

  console.log('Verifying Modal closed and fields synced...');
  await expect(modal).not.toBeVisible({ timeout: 10000 });
  
  // Verify main address bar reflects the change from modal
  // Main address bar uses InterpolatedInput (CodeMirror)
  const mainAddressInput = window.locator('.address-bar .address-input .cm-content');
  await expect(mainAddressInput).toContainText('acme-corp.test:8443', { timeout: 10000 });

  const serviceInput = window.locator('#grpc-service-row .cm-content');
  const methodInput = window.locator('#grpc-method-row .cm-content');
  await expect(serviceInput).toContainText('test.GreetingService', { timeout: 10000 });
  await expect(methodInput).toContainText('SayHello', { timeout: 10000 });

  console.log('Verifying Proto Path persists in main view...');
  const mainProtoInput = window.locator('#grpc-proto-row .cm-content');
  await expect(mainProtoInput).toContainText(protoPath, { timeout: 10000 });

  console.log('Test passed! Taking final screenshot...');
  await window.screenshot({ path: join(tmpdir(), 'ultrarpc-grpc-proto-discovery-success.png') });

  await electronApp.close();
});
