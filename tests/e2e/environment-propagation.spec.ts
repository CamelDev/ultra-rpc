import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pre-seeded environment data — avoids slow UI setup
const SEEDED_ENVIRONMENTS = [
  {
    id: 'env-dev-001',
    name: 'Dev',
    variables: [
      { id: 'v1', key: 'BASE_URL', value: 'dev.api', enabled: true },
    ],
    isActive: false,
    sslVerification: true,
  },
  {
    id: 'env-prod-002',
    name: 'Prod',
    variables: [
      { id: 'v2', key: 'BASE_URL', value: 'prod.api', enabled: true },
    ],
    isActive: false,
    sslVerification: true,
  },
];

test.describe('Environment Propagation & Global Overrides', () => {
  let electronApp: any;
  let window: any;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = join(tmpdir(), `ultrarpc-test-propagation-${Date.now()}`);
    mkdirSync(userDataDir, { recursive: true });
    // Pre-seed environments file so we skip slow UI-based env creation
    writeFileSync(
      join(userDataDir, 'environments.json'),
      JSON.stringify(SEEDED_ENVIRONMENTS),
    );

    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    window = await electronApp.firstWindow();
    window.on('console', (msg: any) => console.log(`[BROWSER]: ${msg.text()}`));
    await window.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir && existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Apply to all tabs should propagate environment to every open tab', async () => {
    test.setTimeout(60000);
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    await wait(1000); // Let the app fully load

    // -- Phase 1: Create a second tab --
    console.log('Adding second tab...');
    await window.click('button.tab-add');
    await wait(500);

    // -- Phase 2: Set each tab to different environments --
    // Tab 0 -> Dev
    console.log('Setting Tab 0 to Dev...');
    await window.locator('.tab-item').nth(0).click();
    await window.locator('.env-selector').first().selectOption({ label: 'Dev' });
    await wait(500);

    // Tab 1 -> Prod
    console.log('Setting Tab 1 to Prod...');
    await window.locator('.tab-item').nth(1).click();
    await window.locator('.env-selector').first().selectOption({ label: 'Prod' });
    await wait(500);

    // Confirm initial state: tabs have different environments
    console.log('Confirming initial state...');
    await window.locator('.tab-item').nth(0).click();
    const tab0InitialEnv = await window.locator('.env-selector').first().inputValue();
    console.log(`Tab 0 initial env id: ${tab0InitialEnv}`);

    await window.locator('.tab-item').nth(1).click();
    const tab1InitialEnv = await window.locator('.env-selector').first().inputValue();
    console.log(`Tab 1 initial env id: ${tab1InitialEnv}`);

    expect(tab0InitialEnv).not.toBe(tab1InitialEnv); // They should be different

    // -- Phase 3: Use "Apply to all tabs" for Prod --
    console.log('Opening Environments panel...');
    await window.click('button[data-tooltip="Environments"]');
    await window.waitForSelector('.env-panel', { state: 'visible', timeout: 10000 });
    await wait(500);

    // Hover over Prod env item to reveal action buttons (opacity: 0 until hover)
    console.log('Locating Prod environment item...');
    const prodEnvItem = window.locator('.env-item').filter({ has: window.locator('.env-name', { hasText: 'Prod' }) }).first();
    await prodEnvItem.scrollIntoViewIfNeeded();
    await prodEnvItem.locator('.env-item-header').hover();
    await wait(300);

    // Handle the confirm dialog
    window.on('dialog', async (dialog: any) => {
      console.log(`Dialog: "${dialog.message()}"`);
      await dialog.accept();
    });

    console.log('Clicking "Apply to all tabs" for Prod...');
    await prodEnvItem.locator('button[data-tooltip="Apply to all tabs"]').click({ force: true });
    await wait(1500);

    // -- Phase 4: Verify both tabs are now Prod --
    console.log('Verifying Tab 0 is now Prod...');
    await window.locator('.tab-item').nth(0).click();
    const tab0EnvAfter = await window.locator('.env-selector option:checked').first().innerText();
    console.log(`Tab 0 env after: ${tab0EnvAfter}`);
    expect(tab0EnvAfter).toBe('Prod');

    console.log('Verifying Tab 1 is still Prod...');
    await window.locator('.tab-item').nth(1).click();
    const tab1EnvAfter = await window.locator('.env-selector option:checked').first().innerText();
    console.log(`Tab 1 env after: ${tab1EnvAfter}`);
    expect(tab1EnvAfter).toBe('Prod');

    console.log('Test passed!');
  });
});
