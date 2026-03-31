import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Runner Comprehensive Scenarios', () => {
  let electronApp: any;
  let page: any;
  const userDataDir = join(__dirname, '../../test-output/user-data/flow-scenarios');

  test.beforeEach(async () => {
    if (fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to cleanup userDataDir, continuing...', e);
      }
    }
    
    console.log('Launching Electron...');
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    
    page = await electronApp.firstWindow();
    page.on('console', (msg: any) => console.log(`[APP CONSOLE] ${msg.text()}`));
    page.on('crash', () => console.error(`[APP CRASH] Page crashed!`));
    
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log('Waiting for app container...');
    await page.waitForSelector('.app-container', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  async function setupCollectionAndRequest() {
    console.log('Setup: Creating collection...');
    const newCollBtn = page.locator('button[data-tooltip="New Collection"]');
    await expect(newCollBtn).toBeVisible({ timeout: 10000 });
    await newCollBtn.click();
    
    await page.waitForSelector('.modal-body input', { state: 'visible', timeout: 10000 });
    await page.fill('.modal-body input', 'test-coll');
    await page.click('button:has-text("Create Collection")');
    
    const collNode = page.locator('.tree-node').filter({ has: page.locator('.tree-node-name', { hasText: /^test-coll$/ }) }).first();
    await expect(collNode).toBeVisible({ timeout: 20000 });
    
    console.log('Opening new tab...');
    await page.click('button.tab-add');
    
    console.log('Creating request...');
    const addressBar = page.locator('.address-input .cm-content');
    await expect(addressBar).toBeVisible({ timeout: 10000 });
    await addressBar.click();
    await page.keyboard.type('https://jsonplaceholder.typicode.com/posts/1');
    
    await page.click('.save-btn');
    await page.waitForSelector('.modal-body input', { state: 'visible', timeout: 10000 });
    await page.fill('.modal-body input', 'Get Post 1');
    
    const modalCollItem = page.locator('.collection-modal-item').filter({ hasText: /^test-coll$/ }).first();
    await modalCollItem.click();
    await page.click('button:has-text("OK")');
    
    console.log('Expanding collection to verify request...');
    await page.waitForTimeout(1000);
    
    // In UltraRPC, Lucide icons have class names like .lucide-chevron-right
    const chevronRight = collNode.locator('.lucide-chevron-right');
    const chevronDown = collNode.locator('.lucide-chevron-down');
    
    if (await chevronRight.isVisible()) {
      console.log('Clicking to expand...');
      await collNode.click(); 
      await expect(chevronDown).toBeVisible({ timeout: 5000 });
    } else if (await chevronDown.isVisible()) {
      console.log('Already expanded.');
    } else {
      console.log('Chevron not found, clicking node anyway to ensure expansion...');
      await collNode.click();
      await page.waitForTimeout(500);
    }
    
    const requestNode = page.locator('.tree-node-name').filter({ hasText: /^Get Post 1$/ });
    await expect(requestNode).toBeVisible({ timeout: 20000 });
    console.log('Setup complete.');
  }

  test('Scenario 1: Fully Automated Execution (No-Loop)', async () => {
    test.setTimeout(180000);
    await setupCollectionAndRequest();

    console.log('Opening Flow Runner...');
    const flowRunnerBtn = page.locator('button[data-tooltip="Flow Runner"]');
    await expect(flowRunnerBtn).toBeEnabled({ timeout: 15000 });
    await flowRunnerBtn.click({ force: true });
    await page.waitForSelector('.flow-panel', { timeout: 15000 });

    console.log('Creating Flow...');
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 5000 });
    await newFlowBtn.click();
    
    await page.waitForSelector('.modal-body input', { state: 'visible' });
    await page.fill('.modal-body input', 'Auto Flow');
    await page.click('button:has-text("Create Flow")');
    await expect(page.locator('.flow-name-input')).toHaveValue('Auto Flow');

    const addStepBtn = page.locator('.btn-add-step');
    
    // 1. Request
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Request")');
    const requestStep = page.locator('.step-card.request').first();
    await page.waitForTimeout(500);
    await requestStep.locator('.selector-trigger').click();
    await page.locator('.request-selector-overlay .tree-node-name').filter({ hasText: 'Get Post 1' }).click();

    // 2. Delay
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Delay")');
    const delayStep = page.locator('.step-card.delay').first();
    await delayStep.locator('input[type="number"]').fill('500');

    // 3. Script
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Script")');
    const scriptStep = page.locator('.step-card.script').first();
    await scriptStep.locator('.cm-content').fill('ultra.context.set("scenario_var", "auto_value");');

    // 4. Assertion
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Assertion")');
    const assertStep = page.locator('.step-card.assert').first();
    await assertStep.locator('button.btn-add-assertion').click();
    const assertionRow = assertStep.locator('.assertion-row-complex').first();
    await assertionRow.locator('select.source-select').first().selectOption('variable');
    await assertionRow.locator('input').first().fill('scenario_var');
    await assertionRow.locator('select.operator-select').selectOption('==');
    await assertionRow.locator('input').last().fill('auto_value');

    console.log('Running Automatic Flow...');
    const runFlowBtn = page.locator('button:has-text("Run Flow")');
    await expect(runFlowBtn).toBeVisible({ timeout: 5000 });
    await expect(runFlowBtn).toBeEnabled();
    await runFlowBtn.click();

    console.log('Waiting for completion...');
    await expect(requestStep).toHaveClass(/success/, { timeout: 30000 });
    await expect(delayStep).toHaveClass(/success/, { timeout: 30000 });
    await expect(scriptStep).toHaveClass(/success/, { timeout: 10000 });
    await expect(assertStep).toHaveClass(/success/, { timeout: 10000 });

    console.log('Scenario 1 Passed!');
  });

  test('Scenario 2: Manual Step-by-Step Run & UI Locking', async () => {
    test.setTimeout(180000);
    await setupCollectionAndRequest();

    console.log('Opening Flow Runner for Scenario 2...');
    const flowRunnerBtn = page.locator('button[data-tooltip="Flow Runner"]');
    await expect(flowRunnerBtn).toBeEnabled({ timeout: 15000 });
    await flowRunnerBtn.click({ force: true });
    await page.waitForSelector('.flow-panel', { timeout: 15000 });

    console.log('Creating Manual Flow...');
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 5000 });
    await newFlowBtn.click();
    
    await page.waitForSelector('.modal-body input');
    await page.fill('.modal-body input', 'Manual Flow');
    await page.click('button:has-text("Create Flow")');

    const addStepBtn = page.locator('.btn-add-step');

    // 1. Request
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Request")');
    const step1 = page.locator('.step-card').nth(0);
    await page.waitForTimeout(500);
    await step1.locator('.selector-trigger').click();
    await page.locator('.request-selector-overlay .tree-node-name').filter({ hasText: 'Get Post 1' }).click();

    // 2. Delay
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Delay")');
    const step2 = page.locator('.step-card').nth(1);
    await step2.locator('input[type="number"]').fill('300');

    // 3. Restart
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Restart")');
    const step3 = page.locator('.step-card').nth(2);

    console.log('Run Step 1 (Request) manually...');
    await step1.locator('button.run-step-btn').click();
    await expect(step1).toHaveClass(/success/, { timeout: 30000 });

    console.log('Verifying UI Lock for Step 1...');
    await expect(step1.locator('.step-drag-handle')).toHaveCount(0);
    await expect(step1.locator('button.delete')).toBeDisabled();
    
    console.log('Verifying ahead is unlocked...');
    await expect(step2.locator('.step-drag-handle')).toBeVisible();

    console.log('Run Step 2 (Delay) manually...');
    await step2.locator('button.run-step-btn').click();
    await expect(step2).toHaveClass(/success/, { timeout: 30000 });

    console.log('Run Step 3 (Restart) manually...');
    await step3.locator('button.run-step-btn').click();

    console.log('Verifying Reset behavior...');
    await expect(step1).toHaveClass(/idle/, { timeout: 10000 });
    await expect(step2).toHaveClass(/idle/, { timeout: 10000 });
    await expect(step1.locator('.step-drag-handle')).toBeVisible();

    console.log('Scenario 2 Passed!');
  });
});
