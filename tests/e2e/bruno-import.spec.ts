import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, '../mocks');
const REST_FIXTURE = join(MOCKS_DIR, 'bruno-rest-collection.yml');
const GRPC_FIXTURE = join(MOCKS_DIR, 'bruno-grpc-collection.yml');

test.describe('Bruno opencollection Import', () => {
  let electronApp: any;
  let page: any;

  test.beforeEach(async () => {
    const userDataDir = join(tmpdir(), `ultrarpc-test-bruno-${Date.now()}`);
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

  test('imports REST collection with nested folder and requests', async () => {
    test.setTimeout(90000);

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, REST_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    // Collection root visible
    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^Bruno REST Test$/ }) }).first();
    await expect(collNode).toBeVisible({ timeout: 20000 });
    console.log('Collection "Bruno REST Test" appeared in sidebar');

    // Expand collection to reveal folder
    await collNode.click();
    const folderNode = page.locator('.tree-node-name').filter({ hasText: /^Auth$/ });
    await expect(folderNode).toBeVisible({ timeout: 10000 });
    console.log('Folder "Auth" visible');

    // Expand folder to reveal request
    await folderNode.click();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^Get Data$/ })).toBeVisible({ timeout: 10000 });
    console.log('Request "Get Data" visible inside folder');
  });

  test('extracts environments and secret vault entries from Bruno collection', async () => {
    test.setTimeout(90000);
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, REST_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');
    // Wait for collection to appear first
    await expect(
      page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^Bruno REST Test$/ }) }).first()
    ).toBeVisible({ timeout: 20000 });

    // Open Environments panel
    await page.click('button[data-tooltip="Environments"]');
    await page.waitForSelector('.env-panel', { state: 'visible', timeout: 10000 });
    await wait(500);

    // Environment named "Test Env" should be present
    const envItem = page.locator('.env-item').filter({ hasText: /Test Env/ }).first();
    await expect(envItem).toBeVisible({ timeout: 10000 });
    console.log('Environment "Test Env" found');

    // Expand it
    await envItem.click();

    // BASE_URL variable should be set
    await expect(envItem.locator('.env-var-key').nth(0)).toHaveValue('BASE_URL');
    await expect(envItem.locator('.env-var-value').nth(0)).toHaveValue('http://127.0.0.1:3341');
    console.log('BASE_URL variable correct');

    // Expand vault section
    await envItem.locator('.vault-header').click();

    // SECRET_KEY should appear as a vault entry (empty value, in vault section)
    const vaultEntries = envItem.locator('.vault-key');
    const vaultCount = await vaultEntries.count();
    expect(vaultCount).toBeGreaterThan(0);
    await expect(vaultEntries.first()).toHaveValue('SECRET_KEY');
    console.log('SECRET_KEY vault entry present');
  });

  test('imports gRPC collection with correct URL and method', async () => {
    test.setTimeout(90000);

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, GRPC_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^Bruno gRPC Test$/ }) }).first();
    await expect(collNode).toBeVisible({ timeout: 20000 });
    console.log('gRPC collection appeared');

    // Expand and open request
    await collNode.click();
    const grpcReq = page.locator('.tree-node-name').filter({ hasText: /^SayHello$/ });
    await expect(grpcReq).toBeVisible({ timeout: 10000 });
    await grpcReq.click();

    // Request tab opens — verify URL contains the gRPC host
    await expect(page.locator('.address-bar .address-input').first()).toContainText('localhost:50051', { timeout: 10000 });
    console.log('gRPC request opened with correct URL');
  });

  test('converts Bruno scripts to ultra.* API on import', async () => {
    test.setTimeout(90000);

    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, REST_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name').filter({ hasText: /^Bruno REST Test$/ }) }).first();
    await expect(collNode).toBeVisible({ timeout: 20000 });

    // Expand and open Get Data
    await collNode.click();
    const folderNode = page.locator('.tree-node-name').filter({ hasText: /^Auth$/ });
    await expect(folderNode).toBeVisible({ timeout: 10000 });
    await folderNode.click();
    await page.locator('.tree-node-name').filter({ hasText: /^Get Data$/ }).click();

    // Navigate to post-response script tab
    await page.click('button:has-text("Post-Response")');

    const scriptContent = await page.locator('.script-editor .cm-content').textContent({ timeout: 10000 });
    expect(scriptContent).toContain('ultra.variables.set');
    expect(scriptContent).not.toContain('bru.setVar');
    console.log('Script correctly converted to ultra.* API');
  });
});
