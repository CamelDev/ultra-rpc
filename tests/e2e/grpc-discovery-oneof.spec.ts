import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockGrpcServer } from '../mocks/grpc-server';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let grpcServer: MockGrpcServer;

test.beforeAll(async () => {
  grpcServer = new MockGrpcServer(0);
  await grpcServer.start();
});

test.afterAll(async () => {
  await grpcServer.stop();
});

test('Should discover services via Reflection and handle oneof fields', async () => {
  const userDataDir = join(__dirname, '../../test-output/user-data/grpc-oneof-reflection');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.app-container', { timeout: 30000 });

  const setCMValue = async (selector: string, value: string) => {
    await window.evaluate(({ s, val }: { s: string, val: string }) => {
      const container = document.querySelector(s);
      const editor = container?.querySelector('.editor-container') as any;
      const { view } = editor.cmView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: val } });
    }, { s: selector, val: value });
    await window.waitForTimeout(500);
  };

  await window.click('button.type-btn:has-text("gRPC")');
  await setCMValue('.address-bar .address-input', `localhost:${grpcServer.getPort()}`);

  console.log('Opening Discover Modal...');
  await window.click('button[title="Discover Services"]');
  await window.waitForSelector('.modal-overlay');

  console.log('Clicking Discover Services in Modal...');
  await window.click('button.reflect-discover-btn');

  console.log('Selecting GreetingService and SayHello...');
  const serviceBtn = window.locator('.reflect-service-btn:has-text("GreetingService")');
  await expect(serviceBtn).toBeVisible({ timeout: 10000 });
  await serviceBtn.click();
  
  const methodBtn = window.locator('.reflect-method-btn').filter({ hasText: 'SayHello' }).first();
  await expect(methodBtn).toBeVisible({ timeout: 10000 });
  await methodBtn.click();

  console.log('Verifying populated fields...');
  await expect(window.locator('#grpc-service-row .cm-content')).toContainText('test.GreetingService');

  console.log('Verifying generated payload with oneof...');
  await window.click('button.config-tab:has-text("Body")');
  const bodyEditor = window.locator('.body-textarea .cm-content');
  
  // generated body should have name and email (first oneof field)
  await expect(bodyEditor).toContainText('"name": "name_sample"');
  await expect(bodyEditor).toContainText('"email": "email_sample"');
  // phone should not be present as only one oneof field should be picked
  const bodyText = await bodyEditor.innerText();
  expect(bodyText).not.toContain('"phone"');

  await electronApp.close();
});

test('Should discover services via Proto File and handle oneof fields', async () => {
  const userDataDir = join(__dirname, '../../test-output/user-data/grpc-oneof-protofile');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.app-container', { timeout: 30000 });

  await window.click('button.type-btn:has-text("gRPC")');
  
  console.log('Opening Discover Modal...');
  await window.click('button[title="Discover Services"]');
  const modal = window.locator('.modal-content');
  await expect(modal).toBeVisible();

  console.log('Switching to Proto File mode...');
  await modal.locator('.reflect-mode-btn:has-text("Proto File")').click();

  console.log('Entering Proto Path...');
  const protoPath = join(__dirname, '../mocks/test.proto');
  await modal.locator('.reflect-proto-input input').fill(protoPath);

  console.log('Clicking Discover Services...');
  await modal.locator('button.reflect-discover-btn').click();

  console.log('Selecting GreetingService and SayHello...');
  const serviceBtn = modal.locator('.reflect-service-btn').filter({ hasText: 'GreetingService' });
  await expect(serviceBtn).toBeVisible({ timeout: 10000 });
  await serviceBtn.click();
  
  const methodBtn = modal.locator('.reflect-method-btn').filter({ hasText: 'SayHello' }).first();
  await expect(methodBtn).toBeVisible({ timeout: 10000 });
  await methodBtn.click();

  console.log('Verifying Body contains oneof sample...');
  await window.click('button.config-tab:has-text("Body")');
  const bodyEditor = window.locator('.body-textarea .cm-content');
  
  await expect(bodyEditor).toContainText('"name": "name_sample"');
  await expect(bodyEditor).toContainText('"email": "email_sample"');
  const bodyText = await bodyEditor.innerText();
  expect(bodyText).not.toContain('"phone"');

  await electronApp.close();
});
