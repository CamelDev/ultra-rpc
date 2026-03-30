import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Variable Persistence', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    const userDataDir = join(__dirname, '../../test-output/user-data/flow-vars');
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('should persist variables set via ultra.context.set() in a flow', async () => {
    // 1. Create a collection first (required to enable New Flow button)
    console.log('Creating collection...');
    await window.click('button[data-tooltip="New Collection"]');
    await window.fill('.modal-body input', 'Test Collection');
    await window.click('button:has-text("Create Collection")');
    await window.waitForSelector('.tree-node:has-text("Test Collection")');
    
    // Give some time for the collections state to propagate
    await window.waitForTimeout(1000);

    // 2. Go to Flows and create a flow
    console.log('Opening Flow Runner panel...');
    const flowsButton = window.locator('button[data-tooltip="Flow Runner"]');
    await flowsButton.click();
    
    // Wait for the panel to switch
    await window.waitForSelector('.flow-panel');
    
    console.log('Clicking New Flow...');
    const newFlowButton = window.locator('.flow-panel-actions button[data-tooltip="New Flow"]');
    await expect(newFlowButton).toBeVisible({ timeout: 10000 });
    await newFlowButton.click();
    
    console.log('Filling flow name...');
    await window.waitForSelector('.modal-body input');
    await window.fill('.modal-body input', 'Variable Test Flow');
    await window.click('button:has-text("Create Flow")');
    
    console.log('Waiting for Flow Canvas...');
    await window.waitForSelector('.flow-canvas');
    await window.waitForTimeout(1000); // Wait for animations
    
    // 3. Add Script step
    console.log('Adding Script step...');
    const addStepBtn = window.locator('.btn-add-step');
    await expect(addStepBtn).toBeVisible({ timeout: 10000 });
    await addStepBtn.click({ force: true });
    
    // Wait for dropdown
    console.log('Selecting Script from dropdown...');
    const scriptOption = window.locator('.add-step-dropdown button').filter({ hasText: 'Script' });
    await expect(scriptOption).toBeVisible({ timeout: 5000 });
    await scriptOption.click({ force: true });
    
    // Wait for step to be added and animation
    await window.waitForTimeout(1000);
    
    // Expand the step to see the editor
    console.log('Expanding step...');
    const lastStep = window.locator('.step-card').last();
    // Use .isVisible() check to handle already-expanded steps
    const isExpanded = await lastStep.locator('.step-card-content').isVisible();
    if (!isExpanded) {
      const expandBtn = lastStep.locator('.icon-btn').first();
      await expandBtn.click();
      // Wait for expansion animation
      await window.waitForTimeout(800);
    }
    
    // 4. Edit scripts to set a variable
    console.log('Setting script content...');
    // Find the editor inside the script step. 
    // We use a more generic locator that handles the injected structure.
    const scriptEditor = lastStep.locator('.cm-content');
    await expect(scriptEditor).toBeVisible({ timeout: 10000 });
    await scriptEditor.fill('ultra.context.set("test_var", "hello_world");');
    
    // 5. Run the flow
    console.log('Running flow...');
    await window.click('button:has-text("Run Flow")');
    
    // Wait for step to finish (success status on step card)
    console.log('Waiting for success...');
    await expect(window.locator('.step-card.success')).toBeVisible({ timeout: 15000 });
    
    // 6. Open Flow Settings (Drawer)
    console.log('Opening settings...');
    await window.click('button:has-text("settings")');
    
    // 7. Verify the variable exists with correct value
    console.log('Verifying variable...');
    const varRow = window.locator('.kv-row').filter({ hasText: 'test_var' });
    await expect(varRow.locator('.kv-value .cm-content')).toHaveText('hello_world');
    console.log('Variable verified successfully!');
  });
});
