import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('Should persist active config tab per request tab', async () => {
  const userDataDir = join(__dirname, '../../test-user-data-tabs-persistence');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const triggerLog = join(__dirname, '../../trigger.txt');
  const browserLog = join(__dirname, '../../trigger-browser.txt');
  if (fs.existsSync(triggerLog)) fs.unlinkSync(triggerLog);
  if (fs.existsSync(browserLog)) fs.unlinkSync(browserLog);

  let electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  let window = await electronApp.firstWindow();
  window.on('console', msg => {
    fs.appendFileSync(browserLog, `BROWSER LOG [${msg.type().toUpperCase()}]: ${msg.text()}\n`);
  });
  await window.waitForSelector('.app-container');
  await window.evaluate(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-dirty') {
          const target = mutation.target as HTMLElement;
          const label = target.querySelector('.tab-title')?.textContent || 'unknown';
          console.log(`[MUTATION] Tab "${label}" data-dirty changed to ${target.getAttribute('data-dirty')}`);
        }
      });
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-dirty'] });
  });

  // Diagnostic: check if Tabs are dirty before doing anything
  const checkDirty = async (label: string) => {
    const lTabs = await window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabs') || '[]'));
    const lastTrigger = await window.evaluate(() => localStorage.getItem('lastDirtyTrigger'));
    const msg = `DIAGNOSTIC [${label}]: ${JSON.stringify(lTabs.map((t: any) => ({ id: t.id, isDirty: t.isDirty, name: t.request.name })))} Last trigger: ${lastTrigger}\n`;
    console.log(msg);
    fs.appendFileSync(triggerLog, msg);
    await window.screenshot({ path: join(__dirname, `../../screenshot-${label.replace(/\s+/g, '-')}.png`) });
  };

  // 1. Initially (1 tab)
  await checkDirty('Initially');

  // 2. Create a second tab
  console.log('Creating second tab...');
  await window.click('button.tab-add');
  await window.waitForTimeout(500);
  await checkDirty('After adding tab');

  // Identify tabs
  const tabItems = window.locator('.tab-item');
  await expect(tabItems).toHaveCount(2);
  const tab1 = tabItems.nth(0);
  const tab2 = tabItems.nth(1);

  // 3. Select Tab 1 (ensure it's active)
  await window.evaluate(() => console.log('::: CLICKING TAB 1 :::'));
  await tab1.click();
  await window.waitForTimeout(200);
  await checkDirty('After Selecting Tab 1');

  // 4. Set Tab 1 to 'Body'
  await window.evaluate(() => console.log('::: CLICKING BODY TAB :::'));
  await window.click('.config-tab:has-text("Body")');
  await window.waitForTimeout(500);
  await checkDirty('After Switching Tab 1 to Body');

  // Verify Tab 1 is NOT dirty
  const lTabsAfterBody = await window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabs') || '[]'));
  const lastTriggerBody = await window.evaluate(() => localStorage.getItem('lastDirtyTrigger'));
  const dirtyStack = await window.evaluate(() => localStorage.getItem('dirtyStack'));
  
  if (lTabsAfterBody[0].isDirty) {
    const failMsg = `\n--- TEST FAILURE ---\nTAB 1 IS DIRTY! TRIGGER: ${lastTriggerBody}\nSTACK: ${dirtyStack}\n`;
    fs.appendFileSync(triggerLog, failMsg);
    // Keep app open a bit longer for screenshot
    await window.waitForTimeout(1000);
    throw new Error(`Tab 1 is dirty! Trigger: ${lastTriggerBody}`);
  }

  // 5. Set Tab 2 to 'Headers'
  console.log('Setting Tab 2 to Headers...');
  await tab2.click();
  await window.waitForTimeout(300);
  await window.click('.config-tab:has-text("Headers")');
  await window.waitForTimeout(300);
  await checkDirty('After Switching Tab 2 to Headers');
  
  // Verify Tab 2 is NOT dirty
  const lTabsAfterTab2 = await window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabs') || '[]'));
  if (lTabsAfterTab2[1].isDirty) {
    throw new Error(`Tab 2 is dirty!`);
  }

  // 6. Switch back to Tab 1 and verify it's still on 'Body'
  console.log('Switching back to Tab 1...');
  await tab1.click();
  await window.waitForTimeout(300);
  await expect(window.locator('.config-tab-active')).toHaveText('Body');
  await checkDirty('Back on Tab 1');

  // 7. Close and reopen the app
  console.log('Restarting app...');
  await electronApp.close();

  electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.app-container');

  // 8. Verify tab-specific persistence
  console.log('Verifying persistence after restart...');
  const restoredTabs = window.locator('.tab-item');
  await expect(restoredTabs).toHaveCount(2);
  
  await restoredTabs.nth(0).click();
  await window.waitForTimeout(300);
  await expect(window.locator('.config-tab-active')).toHaveText('Body');

  await restoredTabs.nth(1).click();
  await window.waitForTimeout(300);
  await expect(window.locator('.config-tab-active')).toHaveText('Headers');

  await electronApp.close();
});
