import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { MockGrpcServer } from '../mocks/grpc-server';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let grpcServer: MockGrpcServer;

test.beforeAll(async () => {
  // Use port 0 to get a random available port, avoiding EADDRINUSE on retries
  grpcServer = new MockGrpcServer(0);
  await grpcServer.start();
});

test.afterAll(async () => {
  await grpcServer.stop();
});

test('Should discover services via reflection and generate payload', async () => {
  const userDataDir = join(__dirname, '../../test-output/user-data/grpc-discovery');
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

  console.log('Switching to gRPC mode...');
  await window.click('button.type-btn:has-text("gRPC")');

  console.log('Setting gRPC address...');
  await setCMValue('.address-bar .address-input', `localhost:${grpcServer.getPort()}`);
 
  console.log('Opening Discover Modal...');
  await window.click('button[title="Discover Services"]');
  await window.waitForSelector('.modal-overlay');

  console.log('Clicking Discover Services in Modal...');
  await window.click('button.reflect-discover-btn');
 
  console.log('Waiting for GreetingService...');

  const serviceBtn = window.locator('.reflect-service-btn:has-text("GreetingService")');
  await expect(serviceBtn).toBeVisible({ timeout: 20000 });
  await serviceBtn.click();

  // Wait for methods to likely load (small buffer)
  await window.waitForTimeout(500);

  console.log('Waiting for SayHello method...');
  // Refined locator: Find the button that contains a .reflect-method-name with EXACT text
  const methodBtn = window.locator('.reflect-method-btn')
    .filter({ has: window.locator('.reflect-method-name', { hasText: /^SayHello$/ }) })
    .first();

  try {
    // If not visible, maybe the first click didn't work? Try clicking service again.
    const isVisible = await methodBtn.isVisible();
    if (!isVisible) {
      console.log('SayHello not visible, retrying service click...');
      await serviceBtn.click(); // Toggle
      await window.waitForTimeout(200);
      await serviceBtn.click(); // Expand again
    }
    await expect(methodBtn).toBeVisible({ timeout: 10000 });
  } catch (e) {
    console.log('SayHello button not found after retry. Taking diagnostic screenshot...');
    await window.screenshot({ path: join(__dirname, '../../test-output/screenshots/ultrarpc-reflection-failure.png') });
    throw e;
  }
  
  console.log('Clicking Use on SayHello...');
  await methodBtn.click();
  await window.waitForTimeout(500);

  console.log('Verifying populated fields...');
  const serviceInput = window.locator('#grpc-service-row .cm-content');
  const methodInput = window.locator('#grpc-method-row .cm-content');
  await expect(serviceInput).toContainText('test.GreetingService');
  await expect(methodInput).toContainText('SayHello');

  console.log('Verifying generated payload...');
  await window.click('button.config-tab:has-text("Body")');
  const bodyEditor = window.locator('.body-textarea .cm-content');
  await expect(bodyEditor).toContainText('"name": ""');

  console.log('Taking success screenshot...');
  await window.screenshot({ path: join(__dirname, '../../test-output/screenshots/ultrarpc-grpc-reflection-success.png') });

  await electronApp.close();
});

test('Should handle server streaming and accumulate responses', async () => {
  test.setTimeout(60000);
  const userDataDir = join(__dirname, '../../test-output/user-data/grpc-streaming');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1200, height: 800 });

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
  
  // Use Proto Path for quick setup instead of reflection
  const protoPath = path.resolve(__dirname, '../mocks/test.proto');
  await setCMValue('#grpc-proto-row', protoPath);
  await setCMValue('#grpc-service-row', 'test.GreetingService');
  await setCMValue('#grpc-method-row', 'SayHellos'); // Note the 's' for streaming

  await window.click('button.config-tab:has-text("Body")', { force: true });
  await wait(500);
  await setCMValue('.body-textarea', '{"name": "Stream Test"}');
  await wait(500);

  console.log('Sending streaming request...');
  await window.click('button.send-btn');

  console.log('Waiting for accumulated streaming response...');
  const resBody = window.locator('.response-viewer .cm-content');
  // Check that it contains an array with multiple greetings
  await expect(resBody).toContainText('"greeting": "Hello 1, Stream Test!"', { timeout: 15000 });
  await expect(resBody).toContainText('"greeting": "Hello 2, Stream Test!"');
  await expect(resBody).toContainText('"greeting": "Hello 3, Stream Test!"');

  await electronApp.close();
});

test('Should decode rich gRPC error details (grpc-status-details-bin)', async () => {
  const userDataDir = join(__dirname, '../../test-output/user-data/grpc-error');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();

  const setCMValue = async (selector: string, value: string) => {
    await window.evaluate(({ s, val }: { s: string, val: string }) => {
      const container = document.querySelector(s);
      if (!container) return;
      const editor = container?.querySelector('.editor-container') as any;
      if (!editor || !editor.cmView) return;
      const { view } = editor.cmView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: val } });
    }, { s: selector, val: value });
    await window.waitForTimeout(500);
  };

  await window.click('button.type-btn:has-text("gRPC")');
  await setCMValue('.address-bar .address-input', `localhost:${grpcServer.getPort()}`);
  
  const protoPath = path.resolve(__dirname, '../mocks/test.proto');
  await setCMValue('#grpc-proto-row', protoPath);
  await setCMValue('#grpc-service-row', 'test.GreetingService');
  await setCMValue('#grpc-method-row', 'SayHelloError');

  console.log('Sending error request...');
  await window.click('button.send-btn');

  console.log('Waiting for decoded error message...');
  const resBody = window.locator('.response-viewer .cm-content');
  
  // Verify main error message (matching the actual output with code prefix)
  await expect(resBody).toContainText('gRPC error (3): 3 INVALID_ARGUMENT');
  
  // Verify server message from google.rpc.Status
  await expect(resBody).toContainText('Server Message: The provided user ID is invalid', { timeout: 15000 });
  
  // Verify decoded ErrorInfo details
  await expect(resBody).toContainText('--- Error Details ---');
  // Note: [Unknown] is due to missing type_url in the decoded object properties (mapped to Unknown in handler)
  await expect(resBody).toContainText('[Unknown]: INVALID_USER_ID | example.com | user_id | 12345');

  await electronApp.close();
});
