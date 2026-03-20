import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const getBaseDir = (suffix: string) => join(__dirname, `../../test-user-data-workspace-${suffix}`);

test.describe('Workspace & UI State', () => {

  test('Tab Persistence & Active Tab Restoration', async () => {
    const userDataDir = getBaseDir('persistence');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    let electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Create 3 tabs with different URLs
    // Tab 1 (default)
    const address1 = window.locator('.address-input .cm-content');
    await address1.click();
    await window.keyboard.press('Meta+A');
    await window.keyboard.press('Backspace');
    await address1.fill('http://localhost:3333/1');
    await window.waitForTimeout(500); // Allow persistence

    // Tab 2
    console.log('Creating Tab 2...');
    await window.click('button.tab-add');
    const address2 = window.locator('.address-input .cm-content');
    await address2.click();
    await address2.fill('http://localhost:3333/2');
    await window.waitForTimeout(500); // Allow persistence
    
    // Tab 3
    console.log('Creating Tab 3...');
    await window.click('button.tab-add');
    const address3 = window.locator('.address-input .cm-content');
    await address3.click();
    await address3.fill('http://localhost:3333/3');
    await window.waitForTimeout(500); // Allow persistence

    // Switch back to Tab 2
    console.log('Switching to Tab 2...');
    // The second tab in the list
    await window.locator('.tab-item').nth(1).click();
    await window.waitForTimeout(500); // Allow active tab persistence
    
    // Close App
    console.log('Closing app...');
    await electronApp.close();

    // Re-launch App
    console.log('Re-launching app...');
    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Verify 3 tabs exist
    const tabs = window.locator('.tab-item');
    await expect(tabs).toHaveCount(3);

    // Verify Tab 2 is active
    const activeTab = window.locator('.tab-item.tab-active');
    // It should be the second tab
    const allTabs = await window.locator('.tab-item').all();
    const activeIndex = await Promise.all(allTabs.map(async (t, i) => {
      const is_active = await t.evaluate(el => el.classList.contains('tab-active'));
      return is_active ? i : -1;
    })).then(ids => ids.find(id => id !== -1));
    
    expect(activeIndex).toBe(1);

    // Check URL in Tab 2
    const currentAddress = await window.locator('.address-input .cm-content').innerText();
    expect(currentAddress.trim()).toBe('http://localhost:3333/2');

    await electronApp.close();
  });

  test('Theme Switching & Persistence', async () => {
    const userDataDir = getBaseDir('theme');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    let electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Open Settings
    await window.click('button.btn-ghost:has(svg.lucide-settings)');
    await window.waitForSelector('.settings-popup');

    // Switch to Light Mode (Daylight)
    console.log('Switching to Light Mode...');
    await window.click('button.theme-toggle-btn:has-text("Daylight")');
    await expect(window.locator('body')).toHaveClass(/light-theme/);
    await window.waitForTimeout(500); // Allow settings persistence

    // Close App
    await electronApp.close();

    // Re-launch App
    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Verify Light Mode persists
    await expect(window.locator('body')).toHaveClass(/light-theme/);

    await electronApp.close();
  });

  test('Layout Switching & Persistence', async () => {
    const userDataDir = getBaseDir('layout');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    let electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Open Settings
    await window.click('button.btn-ghost:has(svg.lucide-settings)');
    await window.waitForSelector('.settings-popup');

    // Toggle Layout to Three-Column (Horizontal)
    console.log('Switching to Horizontal Layout...');
    await window.click('button.layout-toggle');
    // Check for three-column layout class
    await expect(window.locator('.request-section')).toHaveClass(/three-column/);
    await window.waitForTimeout(500); // Allow settings persistence

    // Close App
    await electronApp.close();

    // Re-launch App
    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // Verify Layout persists
    await expect(window.locator('.request-section')).toHaveClass(/three-column/);

    await electronApp.close();
  });

  test('Unsaved Changes (Dirty State) Prompt', async () => {
    const userDataDir = getBaseDir('dirty');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    const electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const window = await electronApp.firstWindow();
    await window.waitForSelector('.app-container');

    // 1. Make tab dirty
    const address = window.locator('.address-input .cm-content');
    await address.click();
    await address.fill('http://dirty.com');
    await window.waitForTimeout(300);
    
    // Verify dirty star appears
    await expect(window.locator('.tab-item.tab-active .tab-title')).toContainText('*');

    // 2. Try to close tab - Verify dialog
    console.log('Attempting to close dirty tab...');
    // Control the dialog
    let dialogShown = false;
    window.on('dialog', async dialog => {
      dialogShown = true;
      expect(dialog.message()).toContain('unsaved changes');
      await dialog.dismiss(); // Cancel symbols closing
    });
    
    await window.click('.tab-item.tab-active .tab-close');
    await window.waitForTimeout(500);
    expect(dialogShown).toBe(true);
    
    // Verify tab still exists
    await expect(window.locator('.tab-item')).toHaveCount(1);
    
    // 3. Try again and accept
    console.log('Attempting to close and accepting...');
    window.removeAllListeners('dialog');
    window.on('dialog', async dialog => {
      await dialog.accept(); // Confirm closing
    });
    
    // Since it's the only tab, it should close and create a new empty one
    await window.click('.tab-item.tab-active .tab-close');
    
    // Verify new empty tab is NOT dirty
    await window.waitForTimeout(500);
    const newActiveTab = window.locator('.tab-item.tab-active');
    await expect(newActiveTab.locator('.tab-title')).not.toContainText('*');
    
    // Check URL is empty or default (placeholder shows up in innerText)
    const currentAddress = await window.locator('.address-input .cm-content').innerText();
    const trimmed = currentAddress.trim();
    expect(trimmed === '' || trimmed === 'https://api.example.com/endpoint').toBe(true);

    await electronApp.close();
  });
});
