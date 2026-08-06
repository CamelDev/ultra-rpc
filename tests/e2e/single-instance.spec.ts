import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const getDataDir = (suffix: string) =>
  join(__dirname, `../../test-output/user-data/single-instance-${suffix}`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Launch Electron WITHOUT `--no-lock` so the real single-instance lock
 * is exercised. Returns the app and its first window.
 */
async function launchApp(userDataDir: string) {
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('.app-container');
  return { app, window };
}

/**
 * Wait for an Electron process to exit. We poll `app.evaluate` because
 * it raises once the underlying process is gone, which is the most
 * reliable signal Playwright gives us for "the process really exited".
 */
async function waitForExit(app: ElectronApplication, timeoutMs = 10_000) {
  await expect
    .poll(
      () =>
        app
          .evaluate(() => process.pid as number)
          .then(() => false)
          .catch(() => true),
      { timeout: timeoutMs, message: 'Electron process should exit' }
    )
    .toBe(true);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Single Instance Lock', () => {

  test('second instance quits immediately while first keeps running', async () => {
    const userDataDir = getDataDir('basic');

    // First instance acquires the lock
    const first = await launchApp(userDataDir);
    const firstWindow = first.window;

    // The first instance has a single window.
    expect(await firstWindow.locator('.app-container').count()).toBe(1);

    // Launch a second instance against the same user-data-dir — it should
    // fail to acquire the lock and exit on its own.
    const second = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    await waitForExit(second);

    // The first instance should still be running with its single window intact.
    expect(await firstWindow.locator('.app-container').count()).toBe(1);
    await expect(firstWindow.locator('.app-container')).toBeVisible();

    await first.app.close();
  });

  test('first instance is still functional after a second-instance attempt', async () => {
    const userDataDir = getDataDir('survives');
    const first = await launchApp(userDataDir);
    const firstWindow = first.window;

    // Launch a second instance — it will fail and exit
    const second = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    await waitForExit(second);

    // The first instance must still respond to UI events: add a new tab.
    const before = await firstWindow.locator('.tab-item').count();
    await firstWindow.click('button.tab-add');
    await firstWindow.waitForTimeout(300);
    const after = await firstWindow.locator('.tab-item').count();
    expect(after).toBe(before + 1);

    await first.app.close();
  });

  test('only one window is created when a second instance is launched', async () => {
    const userDataDir = getDataDir('single-window');
    const first = await launchApp(userDataDir);
    const firstWindow = first.window;

    const before = await firstWindow.locator('.app-container').count();
    expect(before).toBe(1);

    // Launch a second instance — it will be rejected by the lock and quit.
    const second = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    await waitForExit(second);

    // The first instance must still have exactly one window (no extra window
    // is opened by the second-instance event).
    const after = await firstWindow.locator('.app-container').count();
    expect(after).toBe(1);

    await first.app.close();
  });

  test('--no-lock flag bypasses the single-instance lock', async () => {
    const userDataDir = getDataDir('no-lock-bypass');

    // First instance — with --no-lock (used by all the other E2E specs that
    // need to launch multiple isolated instances in the same process tree)
    const first = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const firstWindow = await first.firstWindow();
    await firstWindow.waitForSelector('.app-container');

    // Second instance — also with --no-lock
    const second = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const secondWindow = await second.firstWindow();
    await secondWindow.waitForSelector('.app-container');

    // Both should be running concurrently (skipLock short-circuits the lock).
    await expect(firstWindow.locator('.app-container')).toBeVisible();
    await expect(secondWindow.locator('.app-container')).toBeVisible();

    await first.close();
    await second.close();
  });

});
