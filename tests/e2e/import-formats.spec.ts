import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, '../mocks');
const ULTRA_FIXTURE = join(MOCKS_DIR, 'ultrarpc-collection.json');
const POSTMAN_FIXTURE = join(MOCKS_DIR, 'postman-collection.json');
const BRUNO_FIXTURE = join(MOCKS_DIR, 'bruno-rest-collection.yml');

test.describe('Collection Import Formats', () => {
  let electronApp: any;
  let page: any;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = join(tmpdir(), `ultrarpc-test-import-${Date.now()}`);
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    mkdirSync(userDataDir, { recursive: true });

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
    // Cleanup userDataDir if needed, but keeping it for now to avoid issues
  });

  test('imports UltraRPC JSON collection', async () => {
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, ULTRA_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    const collNode = page.locator('.tree-node-name').filter({ hasText: /^UltraRPC Export Test$/ });
    await expect(collNode).toBeVisible({ timeout: 20000 });
    
    await collNode.click();
    await expect(page.locator('.tree-node-name').filter({ hasText: /^Get Info$/ })).toBeVisible({ timeout: 10000 });
  });

  test('imports Postman JSON collection', async () => {
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, POSTMAN_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    // Postman mock has name "Postman Test" (check mock content) or includes "postman"
    const collNode = page.locator('.tree-node-name').filter({ hasText: /postman/i });
    await expect(collNode).toBeVisible({ timeout: 20000 });
  });

  test('imports Bruno YAML collection', async () => {
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] }) as any;
    }, BRUNO_FIXTURE);

    await page.click('button[data-tooltip="Import collection"]');

    const collNode = page.locator('.tree-node-name').filter({ hasText: /^Bruno REST Test$/ });
    await expect(collNode).toBeVisible({ timeout: 20000 });
  });
});
