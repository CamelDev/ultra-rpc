import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const getBaseDir = (suffix: string) => join(__dirname, `../../test-output/user-data/vault-denial-${suffix}`);

test.describe('Vault Access Denial', () => {
  test('Should show warning and disable vault when encryption is unavailable', async () => {
    const userDataDir = getBaseDir('denied');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    const electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { 
        ...process.env, 
        NODE_ENV: 'test',
        MOCK_VAULT_UNAVAILABLE: 'true' 
      },
    });
    const window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // 1. Open Environment Panel
    await window.click('button.btn-ghost:has(svg.lucide-globe)');
    await window.waitForSelector('.env-panel');

    // 2. Add an environment if none exists
    const envCount = await window.locator('.env-item').count();
    if (envCount === 0) {
      console.log('No environment found, creating one...');
      await window.click('button.env-action-btn:has(svg.lucide-plus)');
      // Wait for at least one env item to appear
      await expect(window.locator('.env-item').first(), 'Environment item should appear after clicking plus').toBeVisible({ timeout: 5000 });
    }

    // 3. Expand the first environment if it's not already expanded
    const firstEnv = window.locator('.env-item').first();
    const isExpanded = await firstEnv.evaluate(el => el.classList.contains('expanded'));
    if (!isExpanded) {
      await window.locator('.env-item-header').first().click();
      await expect(firstEnv, 'Environment item should have expanded class').toHaveClass(/expanded/);
    }

    // 4. Expand Vault section
    const vaultHeader = window.locator('.vault-header');
    await vaultHeader.scrollIntoViewIfNeeded();
    await vaultHeader.click();

    // 5. Verify warning message is visible
    const warning = window.locator('.vault-unavailable-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Vault is disabled because encryption is unavailable');

    // 6. Verify "Add secret" button is disabled
    const addSecretBtn = window.locator('button.vault-add');
    await expect(addSecretBtn).toBeDisabled();

    // 7. Verify inputs are disabled if there were any existing secrets (not applicable in fresh test but good to check)
    const vaultKeys = window.locator('.vault-key');
    const vaultValues = window.locator('.vault-value');
    
    const count = await vaultKeys.count();
    for (let i = 0; i < count; i++) {
      await expect(vaultKeys.nth(i)).toBeDisabled();
      await expect(vaultValues.nth(i)).toBeDisabled();
    }

    await electronApp.close();
  });
});
