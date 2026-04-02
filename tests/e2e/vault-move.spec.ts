import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync } from 'fs';

test.describe('Vault Move Feature', () => {
  let electronApp: any;
  let window: any;
  const userDataDir = join(tmpdir(), `ultrarpc-test-vault-move-${Date.now()}`);

  test.beforeEach(async () => {
    if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
    mkdirSync(userDataDir, { recursive: true });

    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('Should move a variable to the vault', async () => {
    // 1. Open Environments Panel
    await window.click('button[data-tooltip="Environments"]');
    await window.waitForSelector('.env-panel');

    // 2. Add Environment
    await window.click('button[data-tooltip="Add Environment"]');
    await window.waitForSelector('.env-item');
    const envItem = window.locator('.env-item').first();
    
    // Re-ensure it is expanded (it should be by default on create, but let's be robust)
    const isExpanded = await envItem.evaluate((el: HTMLElement) => el.classList.contains('expanded'));
    if (!isExpanded) {
      await envItem.locator('.env-item-header').click();
    }
    await expect(envItem.locator('.env-var-row').first()).toBeVisible({ timeout: 5000 });

    // 3. Set a variable
    const varRow = envItem.locator('.env-var-row').first();
    await varRow.locator('.env-var-key').fill('MY_SECRET');
    await varRow.locator('.env-var-value').fill('top-secret-val');
    
    // 4. Verify Move to Vault button is visible and enabled
    const moveBtn = varRow.locator('button.env-var-vault-move');
    await expect(moveBtn).toBeVisible();
    await expect(moveBtn).toBeEnabled();

    // 5. Click Move to Vault
    await moveBtn.click();

    // 6. Verify variable is no longer in plain-text variable list
    const variableRows = envItem.locator('.env-var-row');
    const rowCount = await variableRows.count();
    for (let i = 0; i < rowCount; i++) {
        const rowInputs = variableRows.nth(i).locator('input');
        const inputsCount = await rowInputs.count();
        for (let j = 0; j < inputsCount; j++) {
            await expect(rowInputs.nth(j)).not.toHaveValue('MY_SECRET');
        }
    }

    // 7. Verify Vault section is expanded and contains the secret
    const vaultSection = envItem.locator('.vault-section');
    await expect(vaultSection.locator('.vault-content')).toBeVisible();
    
    const vaultKey = vaultSection.locator('.vault-key').first();
    await expect(vaultKey).toHaveValue('MY_SECRET');
    
    const vaultValue = vaultSection.locator('.vault-value').first();
    await expect(vaultValue).toHaveValue('top-secret-val');
    await expect(vaultValue).toHaveAttribute('type', 'password');
  });
});
