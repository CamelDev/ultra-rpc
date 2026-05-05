import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, '../mocks');
const BRUNO_HTTP = join(MOCKS_DIR, 'bruno-single-request.yml');
const BRUNO_GRPC = join(MOCKS_DIR, 'bruno-single-grpc.yml');
const POSTMAN_REQ = join(MOCKS_DIR, 'postman-single-request.json');

test.describe('Single Request Import', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    const userDataDir = join(tmpdir(), `ultrarpc-test-import-req-${Date.now()}`);
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    mkdirSync(userDataDir, { recursive: true });

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    page.on('console', (msg: any) => console.log(`[APP] ${msg.text()}`));
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('imports individual Bruno gRPC request and sets bodyType to JSON', async () => {
    test.setTimeout(90000);

    // 1. Create a collection first
    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('input[placeholder="e.g. My API"]', 'Test Collection');
    await page.click('button:has-text("Create Collection")');
    const collNode = page.locator('.tree-node-name').filter({ hasText: /^Test Collection$/ });
    await expect(collNode).toBeVisible();
    console.log('Collection created');

    // 2. Right click collection and select "Import Request"
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, BRUNO_GRPC);

    // Click to select then right click
    await collNode.click();
    await collNode.click({ button: 'right' });
    console.log('Right-clicked collection');
    
    // Wait for context menu
    const importBtn = page.locator('.coll-context-menu button').filter({ hasText: 'Import Request' });
    await expect(importBtn).toBeVisible({ timeout: 5000 });
    await importBtn.click();
    console.log('Clicked Import Request');

    // 3. Verify request is imported and visible
    const reqNode = page.locator('.tree-node-name').filter({ hasText: /^SingleBrunoGrpc$/ });
    await expect(reqNode).toBeVisible({ timeout: 15000 });
    console.log('Imported request visible');

    // 4. Click to open and verify body is visible (JSON selected)
    await reqNode.click();
    console.log('Clicked request node');
    await page.click('button:has-text("Body")');
    console.log('Clicked Body tab');
    await expect(page.locator('.body-type-btn.body-type-active').filter({ hasText: 'JSON' })).toBeVisible({ timeout: 10000 });
    console.log('Body type is JSON');
    
    // Verify it's a gRPC request label
    await expect(page.locator('.coll-req-method-label').filter({ hasText: 'gRPC' })).toBeVisible();
  });

  test('imports individual Bruno HTTP request and defaults to JSON if body present', async () => {
    test.setTimeout(90000);

    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('input[placeholder="e.g. My API"]', 'Test Collection');
    await page.click('button:has-text("Create Collection")');
    const collNode = page.locator('.tree-node-name').filter({ hasText: /^Test Collection$/ });
    await expect(collNode).toBeVisible();
    console.log('Collection created (HTTP)');

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, BRUNO_HTTP);

    await collNode.click();
    await collNode.click({ button: 'right' });
    const importBtn = page.locator('.coll-context-menu button').filter({ hasText: 'Import Request' });
    await expect(importBtn).toBeVisible({ timeout: 5000 });
    await importBtn.click();
    console.log('Clicked Import Request (HTTP)');

    const reqNode = page.locator('.tree-node-name').filter({ hasText: /SingleBrunoRequest/ });
    await expect(reqNode).toBeVisible({ timeout: 15000 });
    console.log('Imported request visible (HTTP)');
    
    await reqNode.click();
    console.log('Clicked request node (HTTP)');
    
    // Wait for the address bar to show the POST method
    await expect(page.locator('.method-select')).toHaveValue('POST', { timeout: 10000 });
    console.log('Method verified as POST');

    // Verify body tab exists and JSON is selected
    const bodyTab = page.locator('button:has-text("Body")');
    await bodyTab.click();
    console.log('Clicked Body tab (HTTP)');
    await expect(page.locator('.body-type-btn.body-type-active').filter({ hasText: 'JSON' })).toBeVisible({ timeout: 10000 });
    console.log('Body type is JSON (HTTP)');
  });

  test('imports Postman request item and sets bodyType to JSON', async () => {
    test.setTimeout(90000);

    await page.click('button[data-tooltip="New Collection"]');
    await page.fill('input[placeholder="e.g. My API"]', 'Test Collection');
    await page.click('button:has-text("Create Collection")');
    const collNode = page.locator('.tree-node-name').filter({ hasText: /^Test Collection$/ });
    await expect(collNode).toBeVisible();
    console.log('Collection created (Postman)');

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, POSTMAN_REQ);

    await collNode.click();
    await collNode.click({ button: 'right' });
    const importBtn = page.locator('.coll-context-menu button').filter({ hasText: 'Import Request' });
    await expect(importBtn).toBeVisible({ timeout: 5000 });
    await importBtn.click();
    console.log('Clicked Import Request (Postman)');

    const reqNode = page.locator('.tree-node-name').filter({ hasText: /SinglePostmanRequest/ });
    await expect(reqNode).toBeVisible({ timeout: 15000 });
    console.log('Imported request visible (Postman)');
    
    await reqNode.click();
    console.log('Clicked request node (Postman)');
    
    // Wait for address bar
    await expect(page.locator('.method-select')).toHaveValue('POST', { timeout: 10000 });

    await page.click('button:has-text("Body")');
    console.log('Clicked Body tab (Postman)');
    await expect(page.locator('.body-type-btn.body-type-active').filter({ hasText: 'JSON' })).toBeVisible({ timeout: 10000 });
    console.log('Body type is JSON (Postman)');
  });
});

