import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const getDataDir = (suffix: string) =>
  join(__dirname, `../../test-output/user-data/tab-groups-${suffix}`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Launch Electron with a clean, isolated userData directory. */
async function launchApp(userDataDir: string) {
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('.app-container');
  return { app, window };
}

/** Right-click a tab by index to open the tab context menu. */
async function rightClickTab(window: Awaited<ReturnType<typeof launchApp>>['window'], index: number) {
  const tab = window.locator('.tab-item').nth(index);
  await tab.click({ button: 'right' });
  await window.waitForSelector('.tab-context-menu');
}

/** Read tab groups from localStorage. */
async function getTabGroups(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  return window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabGroups') || '[]'));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Tab Groups', () => {

  test('Create a new group via right-click context menu', async () => {
    const { app, window } = await launchApp(getDataDir('create'));

    // Ensure we start with one tab
    await expect(window.locator('.tab-item')).toHaveCount(1);

    // Right-click tab 0 → "New group"
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);

    // The group header should now be visible in the tab bar
    await expect(window.locator('.tab-group-header')).toHaveCount(1);

    // The inline rename input should be auto-focused
    await expect(window.locator('.tab-group-rename-input')).toBeVisible();

    // The tab should now carry a group color top border
    const groupId = await window.locator('.tab-item').first().getAttribute('data-group-id');
    expect(groupId).not.toBeFalsy();

    // localStorage should contain the new group
    const groups = await getTabGroups(window);
    expect(groups).toHaveLength(1);
    expect(groups[0].isHidden).toBe(false);
    expect(groups[0].isCollapsed).toBe(false);

    await app.close();
  });

  test('Rename a group inline — via auto-focus on creation', async () => {
    const { app, window } = await launchApp(getDataDir('rename-on-create'));

    // Create group from tab 0
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);

    // An inline input should be visible and focused
    const input = window.locator('.tab-group-rename-input');
    await expect(input).toBeVisible();

    // Type a new name and confirm with Enter
    await input.fill('');
    await input.type('Auth Tests');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // The label should now show the new name
    await expect(window.locator('.tab-group-header-label')).toHaveText('Auth Tests');

    // Persisted in localStorage
    const groups = await getTabGroups(window);
    expect(groups[0].name).toBe('Auth Tests');

    await app.close();
  });

  test('Rename a group inline — via double-click', async () => {
    const { app, window } = await launchApp(getDataDir('rename-dblclick'));

    // Create group, commit the default name with Enter
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Double-click the pill to re-enter rename mode
    await window.locator('.tab-group-header-pill').dblclick();
    await expect(window.locator('.tab-group-rename-input')).toBeVisible();

    // Type a new name and confirm with Enter
    await window.locator('.tab-group-rename-input').fill('');
    await window.locator('.tab-group-rename-input').type('Renamed');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    await expect(window.locator('.tab-group-header-label')).toHaveText('Renamed');

    await app.close();
  });

  test('Add a second tab to an existing group', async () => {
    const { app, window } = await launchApp(getDataDir('add-to-group'));

    // Create a second tab
    await window.click('button.tab-add');
    await window.waitForTimeout(300);
    await expect(window.locator('.tab-item')).toHaveCount(2);

    // Create a group from tab 0, commit default name
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Right-click tab 1 and add to the existing group
    await rightClickTab(window, 1);
    await window.waitForSelector('.tab-ctx-section-label:has-text("Add to group")');
    // The existing group should appear under "Add to group"
    const groupOption = window.locator('.tab-ctx-item').filter({ hasText: 'Group 1' });
    await expect(groupOption).toBeVisible();
    await groupOption.click();
    await window.waitForTimeout(300);

    // Both tabs should now carry the same group-id
    const id0 = await window.locator('.tab-item').nth(0).getAttribute('data-group-id');
    const id1 = await window.locator('.tab-item').nth(1).getAttribute('data-group-id');
    expect(id0).toBe(id1);
    expect(id0).not.toBeFalsy();

    // Still only one group header
    await expect(window.locator('.tab-group-header')).toHaveCount(1);

    // localStorage shows 2 tabs in same group
    const storedTabs = await window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabs') || '[]'));
    const grouped = storedTabs.filter((t: any) => t.groupId);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].groupId).toBe(grouped[1].groupId);

    await app.close();
  });

  test('Remove a tab from its group', async () => {
    const { app, window } = await launchApp(getDataDir('remove-from-group'));

    // Create group on tab 0
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Verify it's grouped
    let groupId = await window.locator('.tab-item').nth(0).getAttribute('data-group-id');
    expect(groupId).not.toBeFalsy();

    // Right-click the same tab and remove from group
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("Remove from group")');
    await window.waitForTimeout(300);

    // Tab should no longer have a group-id
    groupId = await window.locator('.tab-item').nth(0).getAttribute('data-group-id');
    expect(groupId).toBeFalsy();

    // Group header disappears (no tabs in group left)
    await expect(window.locator('.tab-group-header')).toHaveCount(0);

    // Group should be cleaned up from localStorage
    const groups = await getTabGroups(window);
    // Note: the group record persists (it still contains 0 members) — that is by design.
    // What matters is no tab references it.
    const storedTabs = await window.evaluate(() => JSON.parse(localStorage.getItem('ultraRpcTabs') || '[]'));
    const groupedTabs = storedTabs.filter((t: any) => t.groupId);
    expect(groupedTabs).toHaveLength(0);

    await app.close();
  });

  test('Collapse and expand a group', async () => {
    const { app, window } = await launchApp(getDataDir('collapse'));

    // Create a second tab then group tab 0
    await window.click('button.tab-add');
    await window.waitForTimeout(300);

    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Both tabs visible
    await expect(window.locator('.tab-item')).toHaveCount(2);

    // Click group header to collapse
    await window.locator('.tab-group-header').click();
    await window.waitForTimeout(300);

    // The grouped tab (tab 0) should disappear; tab 1 (ungrouped) stays
    const visibleItems = window.locator('.tab-item');
    // Only the ungrouped tab should be visible
    await expect(visibleItems).toHaveCount(1);

    // localStorage: group should have isCollapsed = true
    const groupsAfterCollapse = await getTabGroups(window);
    expect(groupsAfterCollapse[0].isCollapsed).toBe(true);

    // Click header again to expand
    await window.locator('.tab-group-header').click();
    await window.waitForTimeout(300);

    // Both tabs visible again
    await expect(window.locator('.tab-item')).toHaveCount(2);

    const groupsAfterExpand = await getTabGroups(window);
    expect(groupsAfterExpand[0].isCollapsed).toBe(false);

    await app.close();
  });

  test('Open Tab Groups modal via Layers button', async () => {
    const { app, window } = await launchApp(getDataDir('modal'));

    // Create a group first
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // The Layers button should show a badge
    const layersBtn = window.locator('button.tab-groups-btn');
    await expect(layersBtn).toBeVisible();
    await expect(layersBtn.locator('.tab-groups-badge')).toHaveText('1');

    // Click to open the modal
    await layersBtn.click();
    await window.waitForSelector('.tab-groups-modal');

    // The group entry should be listed
    await expect(window.locator('.tab-groups-modal')).toBeVisible();

    // Close via X button
    await window.click('.tab-groups-modal .modal-close-btn, .tab-groups-modal button:has(svg.lucide-x)');
    await window.waitForTimeout(200);
    await expect(window.locator('.tab-groups-modal')).not.toBeVisible();

    await app.close();
  });

  test('Hide and show a group via modal', async () => {
    const { app, window } = await launchApp(getDataDir('hide-show'));

    // Create group on tab 0
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Add a second tab (ungrouped) so we can still count tabs
    await window.click('button.tab-add');
    await window.waitForTimeout(300);
    await expect(window.locator('.tab-item')).toHaveCount(2);

    // Open modal and toggle visibility (eye icon)
    await window.locator('button.tab-groups-btn').click();
    await window.waitForSelector('.tab-groups-modal');
    // Click the hide/show toggle button
    await window.locator('.tab-groups-modal button[title*="Hide"], .tab-groups-modal button:has(svg.lucide-eye)').first().click();
    await window.waitForTimeout(300);

    // Group tab should be hidden — only the ungrouped tab remains
    await expect(window.locator('.tab-item')).toHaveCount(1);
    await expect(window.locator('.tab-group-header')).toHaveCount(0);

    // localStorage: isHidden = true
    const hiddenGroups = await getTabGroups(window);
    expect(hiddenGroups[0].isHidden).toBe(true);

    // Toggle back to visible
    await window.locator('.tab-groups-modal button[title*="Show"], .tab-groups-modal button:has(svg.lucide-eye-off)').first().click();
    await window.waitForTimeout(300);

    await expect(window.locator('.tab-item')).toHaveCount(2);
    await expect(window.locator('.tab-group-header')).toHaveCount(1);

    const shownGroups = await getTabGroups(window);
    expect(shownGroups[0].isHidden).toBe(false);

    await app.close();
  });

  test('Delete a group via modal — tabs become ungrouped', async () => {
    const { app, window } = await launchApp(getDataDir('delete'));

    // Create group
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    await expect(window.locator('.tab-group-header')).toHaveCount(1);

    // Open modal
    await window.locator('button.tab-groups-btn').click();
    await window.waitForSelector('.tab-groups-modal');

    // Click delete (trash icon)
    await window.locator('.tab-groups-modal button:has(svg.lucide-trash2)').first().click();
    await window.waitForTimeout(200);

    // Confirm the inline confirmation
    await window.locator('.tab-groups-modal button:has-text("Delete")').click();
    await window.waitForTimeout(300);

    // Group header gone
    await expect(window.locator('.tab-group-header')).toHaveCount(0);

    // Tab still exists but is ungrouped
    await expect(window.locator('.tab-item')).toHaveCount(1);
    const groupId = await window.locator('.tab-item').first().getAttribute('data-group-id');
    expect(groupId).toBeFalsy();

    // localStorage: no groups remain
    const groups = await getTabGroups(window);
    expect(groups).toHaveLength(0);

    await app.close();
  });

  test('Tab groups persist across app restarts', async () => {
    const userDataDir = getDataDir('persist');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    // ── Session 1 ──
    const app1 = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const w1 = await app1.firstWindow();
    await w1.waitForSelector('.app-container');

    // Create group, name it
    await w1.locator('.tab-item').first().click({ button: 'right' });
    await w1.waitForSelector('.tab-context-menu');
    await w1.click('.tab-ctx-item:has-text("New group")');
    await w1.waitForTimeout(300);
    const input = w1.locator('.tab-group-rename-input');
    await input.fill('');
    await input.type('Persistent Group');
    await w1.keyboard.press('Enter');
    await w1.waitForTimeout(500); // allow localStorage flush

    await app1.close();
    await new Promise(r => setTimeout(r, 500));

    // ── Session 2 ──
    const app2 = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const w2 = await app2.firstWindow();
    await w2.waitForSelector('.app-container');
    await w2.waitForTimeout(1000); // let React hydrate from localStorage

    // Group header should be restored
    await expect(w2.locator('.tab-group-header')).toHaveCount(1);
    await expect(w2.locator('.tab-group-header-label')).toHaveText('Persistent Group');

    // Layers badge should show 1
    await expect(w2.locator('button.tab-groups-btn .tab-groups-badge')).toHaveText('1');

    await app2.close();
  });

  test('Change group color in modal updates tab stripe and header', async () => {
    const { app, window } = await launchApp(getDataDir('color'));

    // Create group
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Record initial color
    const initialColor = await getTabGroups(window).then((g: any[]) => g[0]?.color);

    // Open modal and pick a different color swatch (second swatch)
    await window.locator('button.tab-groups-btn').click();
    await window.waitForSelector('.tab-groups-modal');
    const swatches = window.locator('.tab-group-color-btn');
    await swatches.nth(2).click(); // pick swatch[2] (whichever color it is)
    await window.waitForTimeout(300);

    // Color should have changed
    const newColor = await getTabGroups(window).then((g: any[]) => g[0]?.color);
    expect(newColor).not.toBe(initialColor);

    await app.close();
  });

  test('Rename a group via modal', async () => {
    const { app, window } = await launchApp(getDataDir('rename-modal'));

    // Create group on tab 0
    await rightClickTab(window, 0);
    await window.click('.tab-ctx-item:has-text("New group")');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Open modal
    await window.locator('button.tab-groups-btn').click();
    await window.waitForSelector('.tab-groups-modal');

    // Click rename (edit icon)
    await window.locator('.tab-groups-modal .tab-group-rename-btn').first().click();
    await window.waitForTimeout(200);

    // Type a new name and confirm with Enter
    const input = window.locator('.tab-groups-modal input.tab-group-rename-input');
    await expect(input).toBeVisible();
    await input.fill('');
    await input.type('Modal Renamed Group');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);

    // Group name in modal should be updated
    await expect(window.locator('.tab-groups-modal .tab-group-name').first()).toHaveText('Modal Renamed Group');

    // Close via X button
    await window.click('.tab-groups-modal .modal-close-btn, .tab-groups-modal button:has(svg.lucide-x)');
    await window.waitForTimeout(200);
    
    // Group name in main tab bar should be updated
    await expect(window.locator('.tab-group-header-label')).toHaveText('Modal Renamed Group');

    // Persisted in localStorage
    const groups = await getTabGroups(window);
    expect(groups[0].name).toBe('Modal Renamed Group');

    await app.close();
  });

});

