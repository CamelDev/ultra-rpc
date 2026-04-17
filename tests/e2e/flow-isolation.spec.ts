import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Flow Execution Isolation', () => {
  let electronApp: any;
  let page: any;
  const userDataDir = join(__dirname, '../../test-output/user-data/flow-isolation');

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

  test('Flows executed concurrently are isolated by tab', async () => {
    test.setTimeout(180000);

    // Setup: Need a collection to save to.
    console.log('Setup: Creating collection...');
    const newCollBtn = page.locator('button[data-tooltip="New Collection"]');
    await expect(newCollBtn).toBeVisible({ timeout: 10000 });
    await newCollBtn.click();
    
    await page.waitForSelector('.modal-body input', { state: 'visible', timeout: 10000 });
    await page.fill('.modal-body input', 'Test Collection');
    await page.click('button:has-text("Create Collection")');

    // Open Flow Panel
    console.log('Opening Flow Runner panel...');
    const flowRunnerBtn = page.locator('button[data-tooltip="Flow Runner"]');
    await expect(flowRunnerBtn).toBeEnabled({ timeout: 15000 });
    await flowRunnerBtn.click({ force: true });
    await page.waitForSelector('.flow-panel', { timeout: 15000 });

    // Create Flow 1
    console.log('Creating Flow 1...');
    const newFlowBtn = page.locator('.flow-panel-actions button[title="New Flow"]');
    await expect(newFlowBtn).toBeVisible({ timeout: 5000 });
    await newFlowBtn.click();
    
    await page.waitForSelector('.modal-body input', { state: 'visible' });
    await page.fill('.modal-body input', 'Flow 1');
    await page.click('button:has-text("Create Flow")');

    const addStepBtn = page.locator('.btn-add-step');

    // Add Delay Step to Flow 1
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Delay")');
    const delayStep1 = page.locator('.step-card.delay').first();
    await delayStep1.locator('input[type="number"]').fill('5000'); // 5 seconds delay so it runs for a bit

    // Create Flow 2
    console.log('Creating Flow 2...');
    await newFlowBtn.click();
    await page.waitForSelector('.modal-body input', { state: 'visible' });
    await page.fill('.modal-body input', 'Flow 2');
    await page.click('button:has-text("Create Flow")');

    // Add script step to Flow 2 to verify it works
    await expect(page.locator('.flow-name-input')).toHaveValue('Flow 2');
    await addStepBtn.click();
    await page.click('.add-step-dropdown button:has-text("Script")');
    const scriptStep2 = page.locator('.step-card.script').first();
    await scriptStep2.locator('.cm-content').fill('ultra.context.set("flow2", "running");');

    // We now have 2 tabs. Tab nth(0) is Intro Page? Tab nth(1) is Flow 1, Tab nth(2) is Flow 2.
    // Let's rely on tab text to click them.
    const flow1Tab = page.locator('.tab-item', { hasText: 'Flow 1' });
    const flow2Tab = page.locator('.tab-item', { hasText: 'Flow 2' });

    // Switch to Flow 1
    console.log('Switching to Flow 1...');
    await flow1Tab.click();
    await expect(page.locator('.flow-name-input')).toHaveValue('Flow 1');

    // Run Flow 1
    console.log('Running Flow 1...');
    const runBtn = page.locator('button.btn.run');
    await runBtn.click();
    
    // Verify Run button changed to Stop
    const stopBtn = page.locator('button.btn.stop');
    await expect(stopBtn).toBeVisible({ timeout: 2000 });

    // Immediately switch to Flow 2
    console.log('Switching to Flow 2 while Flow 1 is running...');
    await flow2Tab.click();
    await expect(page.locator('.flow-name-input')).toHaveValue('Flow 2');

    // Verify Flow 2 is NOT running (Run button is present, Stop button is missing)
    await expect(runBtn).toBeVisible({ timeout: 2000 });
    await expect(stopBtn).toHaveCount(0);

    // Run Flow 2
    console.log('Running Flow 2...');
    await runBtn.click();
    
    // Flow 2 should finish very fast (script step)
    await expect(scriptStep2).toHaveClass(/success/, { timeout: 10000 });
    
    // Flow 2 Run button should be back
    await expect(runBtn).toBeVisible({ timeout: 5000 });

    // Verify Flow 2 logs right here while it is active, since switching tabs clears local UI logs
    if (await page.locator('.flow-log-viewer-collapsed').isVisible()) {
      await page.click('.flow-log-viewer-collapsed'); 
    }
    const logsText2 = await page.locator('.log-content').innerText();
    expect(logsText2).toContain('Variable set: flow2 = running');

    // Switch back to Flow 1
    console.log('Switching back to Flow 1 to check progress...');
    await flow1Tab.click();
    await expect(page.locator('.flow-name-input')).toHaveValue('Flow 1');

    // Wait for Flow 1 to naturally finish
    console.log('Waiting for Flow 1 to finish...');
    const step1 = page.locator('.step-card.delay').first();
    await expect(step1).toHaveClass(/success/, { timeout: 10000 });
    
    // Verify isolated logs: Flow 1 should not have a log about variable flow2 being set
    if (await page.locator('.flow-log-viewer-collapsed').isVisible()) {
      await page.click('.flow-log-viewer-collapsed'); // expand logs if closed
    }
    const logsText = await page.locator('.log-content').innerText();
    expect(logsText).not.toContain('Variable set: flow2 = running');

    console.log('Test Passed: Isolation verified!');
  });
});
