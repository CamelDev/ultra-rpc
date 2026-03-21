import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { MockRestServer } from '../mocks/rest-server';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Environment & Variable Resolution', () => {
  let electronApp: any;
  let window: any;
  let restServer: MockRestServer;
  let httpsServer: MockRestServer;
  const userDataDir = join(tmpdir(), `ultrarpc-test-env-${Date.now()}`);
  const certDir = join(__dirname, '../mocks/certs');

  test.beforeAll(async () => {
    // Generate self-signed cert for HTTPS testing if not exists
    if (!existsSync(certDir)) mkdirSync(certDir, { recursive: true });
    const keyPath = join(certDir, 'key.pem');
    const certPath = join(certDir, 'cert.pem');
    
    if (!existsSync(keyPath) || !existsSync(certPath)) {
      console.log('Generating self-signed certificate for E2E tests...');
      try {
        execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`, { stdio: 'inherit' });
      } catch (err) {
        console.error('Failed to generate certs with openssl, failing test.', err);
        throw err;
      }
    }

    console.log('Starting HTTP mock server on random port...');
    restServer = new MockRestServer(0);
    await restServer.start();

    console.log('Starting HTTPS mock server on random port...');
    httpsServer = new MockRestServer(0, {
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8')
    });
    await httpsServer.start();
  });

  test.afterAll(async () => {
    await restServer.stop();
    await httpsServer.stop();
  });

  test.beforeEach(async () => {
    // Ensure clean state for every test
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    mkdirSync(userDataDir, { recursive: true });
    
    console.log('Launching Electron...');
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    
    console.log('App launched, waiting for window...');
    try {
      window = await electronApp.firstWindow();
      if (!window) {
        window = await electronApp.waitForEvent('window', { timeout: 30000 });
      }
      
      // Mirror console for debugging
      window.on('console', (msg: any) => {
        console.log(`[BROWSER ${msg.type()}]: ${msg.text()}`);
      });

      console.log('Window acquired, waiting for .app-container...');
      await window.waitForSelector('.app-container', { state: 'attached', timeout: 60000 });
      console.log('App container FOUND.');
    } catch (err) {
      console.error('FAILED to acquire window or .app-container within timeout.');
      throw err;
    }
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
      electronApp = null;
    }
  });

  test('Should handle environment variables, SSL toggle, and persistence', async () => {
    test.setTimeout(120000);
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const setCMValue = async (selector: string, value: string) => {
      console.log(`[setCMValue] Starting for "${selector}"...`);
      
      await window.waitForSelector(selector, { state: 'attached', timeout: 20000 });
      
      await window.waitForFunction((s: string) => {
        const container = document.querySelector(s);
        if (!container) return false;
        const editor = container.querySelector('.editor-container');
        if (!editor) return false;
        return (editor as any).cmView && (editor as any).cmView.view;
      }, selector, { timeout: 20000 });

      await window.evaluate(({ s, val }: { s: string, val: string }) => {
        const container = document.querySelector(s);
        const editor = container?.querySelector('.editor-container') as any;
        const { view } = editor.cmView;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: val }
        });
      }, { s: selector, val: value });
      
      await wait(500);
      console.log(`[setCMValue] Done for "${selector}".`);
    };

    // Special helper for env variables which are standard inputs
    const setEnvVarValue = async (key: string, value: string) => {
      console.log(`Setting Env Var "${key}" to "${value}"...`);
      
      // Find the row first
      const row = window.locator('.env-var-row', { has: window.locator('input.env-var-key', { hasValue: key }) }).first();
      await row.waitFor({ state: 'visible', timeout: 15000 });
      
      // Target the value input
      const valueInput = row.locator('input.env-var-value').first();
      await valueInput.waitFor({ state: 'visible', timeout: 10000 });
      
      // Use standard fill instead of CM dispatch
      await valueInput.fill(value);
      await wait(1000);
    };

    // Helper to ensure a sidebar panel is open with aggressive retry
    const ensurePanelOpen = async (tooltip: string, panelSelector: string) => {
      console.log(`Ensuring panel "${tooltip}" is open (with retry)...`);
      const btn = window.locator(`button[data-tooltip="${tooltip}"]`).first();
      await btn.waitFor({ state: 'visible' });
      
      const startTime = Date.now();
      const timeout = 20000;
      
      while (Date.now() - startTime < timeout) {
        const isActive = await btn.evaluate((el: HTMLElement) => el.classList.contains('env-toggle-active'));
        if (isActive) {
          // If active class is present, now check if the panel content is actually visible
          const isContentVisible = await window.locator(panelSelector).isVisible().catch(() => false);
          if (isContentVisible) {
            console.log(`Panel "${tooltip}" is now ACTIVE and VISIBLE.`);
            return;
          }
          console.log(`Panel "${tooltip}" has active class but content not visible yet...`);
        } else {
          console.log(`Clicking "${tooltip}" toggle...`);
          await btn.click({ force: true }).catch(() => {});
        }
        await wait(2000);
      }
      
      throw new Error(`Failed to open panel "${tooltip}" within ${timeout}ms`);
    };

    const httpPort = restServer.getPort();
    const httpsPort = httpsServer.getPort();

    await window.waitForSelector('.app-container');
    await wait(2000);

    console.log('--- Phase 0: Baseline Request ---');
    await setCMValue('.address-bar .address-input', `http://127.0.0.1:${httpPort}/data`);
    await window.locator('.send-btn').first().click({ force: true });
    
    console.log('Waiting for baseline response...');
    await window.waitForSelector('.response-status-badge', { timeout: 10000 });
    await expect(window.locator('.response-status-badge')).toContainText('200 OK');
    console.log('Baseline request SUCCESS.');

    console.log(`--- Phase 1: Variable Interpolation (Ports: ${httpPort}, ${httpsPort}) ---`);
    await ensurePanelOpen('Environments', '.env-panel');
    await wait(3000); // Absolute settling time
    
    console.log('Searching for "Add Environment" button...');
    const addEnvBtn = window.locator('button[data-tooltip="Add Environment"]').first();
    await addEnvBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addEnvBtn.scrollIntoViewIfNeeded();
    await addEnvBtn.hover();
    await addEnvBtn.click({ force: true });
    
    console.log('Waiting for new environment item...');
    await window.waitForSelector('.env-item', { state: 'visible', timeout: 15000 });
    await wait(2000);
    
    // Rename environment
    console.log('Renaming environment...');
    const lastEnv = window.locator('.env-item').last();
    await lastEnv.scrollIntoViewIfNeeded();
    await lastEnv.locator('button[data-tooltip="Rename"]').first().click({ force: true });
    
    console.log('Waiting for rename input...');
    await window.waitForSelector('.env-name-input', { state: 'visible', timeout: 15000 });
    await window.locator('.env-name-input').first().fill('Production');
    await window.keyboard.press('Enter');
    await wait(2000); 
    
    // Add variables using exact row indexes
    console.log('Filling BASE_URL...');
    await window.locator('.env-var-row').nth(0).locator('.env-var-value').fill(`http://127.0.0.1:${httpPort}`);
    
    console.log('Filling AUTH_TOKEN...');
    await window.locator('.env-var-row').nth(1).locator('.env-var-value').fill('secret-123');
    
    console.log('Adding USER_NAME...');
    await window.locator('.env-var-row').nth(2).locator('.env-var-key').fill('USER_NAME');
    await window.locator('.env-var-row').nth(2).locator('.env-var-value').fill('UltraDev');
    await wait(2000); // Ensure state saved

    console.log('Selecting active environment via address bar...');
    const selector = window.locator('.env-selector').first();
    await window.waitForFunction(() => {
      const opts = document.querySelectorAll('.env-selector option');
      return Array.from(opts).some(o => o.textContent === 'Production');
    });
    
    await selector.selectOption({ label: 'Production' });
    await selector.dispatchEvent('change');
    await wait(1000); 
    
    await expect(selector).toContainText('Production');

    console.log('Closing panel...');
    await window.locator('button[data-tooltip="Environments"]').first().click(); // Close
    await wait(1000);

    console.log('Configuring request...');
    // Inject script to track App's environments state
    const debugUrl = await window.evaluate(() => {
      // Find a way to verify variables
      return (window as any).ultraRpc.__DEBUG_VARS || 'none'
    });
    
    await setCMValue('.address-bar .address-input', '{{BASE_URL}}/echo');
    
    await window.locator('button.config-tab:has-text("Headers")').first().click();
    // First header row key/value
    await setCMValue('.kv-row:nth-child(2) .kv-key', 'Authorization');
    await setCMValue('.kv-row:nth-child(2) .kv-value', 'Bearer {{AUTH_TOKEN}}');
    
    await window.locator('button.config-tab:has-text("Body")').first().click();
    await window.locator('.method-select').first().selectOption('POST');
    
    // Explicitly click JSON body type to be absolutely sure
    const jsonBtn = window.locator('button.body-type-btn:has-text("JSON")');
    if (await jsonBtn.isVisible()) {
      await jsonBtn.click();
    }
    
    await setCMValue('.body-textarea', '{"hello": "{{USER_NAME}}"}');
    await wait(2000); // Wait for React state to fully settle

    console.log('Sending request...');
    await window.locator('.send-btn').first().click({ force: true });
    
    try {
      await Promise.race([
        window.waitForSelector('.response-status-badge', { state: 'attached', timeout: 20000 }),
        window.waitForSelector('.response-error-msg', { state: 'attached', timeout: 20000 })
      ]);
    } catch {}
    
    if (await window.locator('.response-error-msg').isVisible()) {
      const errMsg = await window.locator('.response-error-msg').innerText();
      console.error(`E2E TEST REACHED ERROR MESSAGE: ${errMsg}`);
      throw new Error(`Request failed with error: ${errMsg}`);
    }
    const responseBodyHtml = await window.locator('.response-viewer .cm-content').first().innerText();
    expect(responseBodyHtml).toContain('UltraDev');
    expect(responseBodyHtml.toLowerCase()).toContain('bearer secret-123');

    // --- Phase 4: gRPC SSL Verification ---
    console.log('--- Phase 4: gRPC SSL Verification ---');
    
    console.log('Adding new tab for gRPC...');
    await window.locator('button.tab-add').click();
    await wait(1000);

    await ensurePanelOpen('Environments', '.env-panel');
    
    console.log('Adding External gRPC environment...');
    await window.locator('button[data-tooltip="Add Environment"]').first().click();
    await wait(500);
    
    // The new env is the last one
    const newEnvItem = window.locator('.env-item').last();
    await newEnvItem.locator('.env-item-header').click(); // expand
    await wait(500);

    console.log('Configuring GRPC_HOST...');
    // Replace the default "New Environment" name
    await newEnvItem.locator('button[data-tooltip="Rename"]').first().click();
    await wait(500);
    const nameInput = newEnvItem.locator('input.env-name-input');
    await nameInput.fill('External gRPC');
    await nameInput.press('Enter');
    await wait(500);
    
    console.log('Finding the renamed environment...');
    const grpcEnv = window.locator('.env-item').filter({ hasText: 'External gRPC' }).first();
    await grpcEnv.waitFor({ state: 'visible' });

    // Ensure it's expanded
    const isExpanded = await grpcEnv.locator('.env-item-body').isVisible();
    if (!isExpanded) {
      console.log('Env collapsed, re-expanding...');
      await grpcEnv.locator('.env-item-header').click();
      await wait(500);
    }
    
    // Add grpc_host variable
    console.log('Adding grpc_host variable...');
    await grpcEnv.locator('.kv-add').click();
    const lastVarRow = grpcEnv.locator('.env-var-row').last();
    await lastVarRow.locator('.env-var-key').fill('grpc_host');
    await lastVarRow.locator('.env-var-value').fill('https://grpcb.in:9001');
    
    console.log('Selecting External gRPC environment...');
    await window.locator('.env-selector').first().selectOption({ label: 'External gRPC' });
    await wait(500);

    console.log('Closing panel...');
    await window.locator('button[data-tooltip="Environments"]').first().click(); 
    await wait(500);

    console.log('Configuring gRPC request...');
    await window.locator('button.type-btn').filter({ hasText: 'gRPC' }).click();
    await wait(500);
    await setCMValue('.address-bar .address-input', '{{grpc_host}}');
    await wait(1000);
    
    console.log('Triggering Reflection...');
    // The button text is "Discover Services"
    await window.locator('button.reflect-discover-btn').click();
    
    console.log('Waiting for services...');
    await window.waitForSelector('.reflect-service-item', { timeout: 20000 });
    const serviceList = await window.locator('.reflect-service-item').allTextContents();
    expect(serviceList.some((s: string) => s.includes('addsvc.Add'))).toBeTruthy();
    
    console.log('Expanding service...');
    await window.locator('.reflect-service-btn').filter({ hasText: 'addsvc.Add' }).click();
    await wait(1000);
    
    console.log('Selecting method...');
    await window.locator('.reflect-method-btn').filter({ hasText: 'Sum' }).click();
    await wait(1000);
    
    console.log('Sending gRPC call...');
    await window.locator('.send-btn').first().click();
    
    console.log('Waiting for gRPC response...');
    await window.waitForSelector('.response-status-badge', { timeout: 15000 });
    await expect(window.locator('.response-status-badge')).toContainText('0 OK');
    
    const grpcResponseBody = await window.locator('.response-viewer .cm-content').first().innerText();
    expect(grpcResponseBody).toContain('"v"'); // Part of Sum response


    console.log('--- Phase 3: Persistence ---');
    console.log('Ensuring History panel is ON...');
    await ensurePanelOpen('History', '.hist-panel');
    
    console.log('Restarting application...');
    await electronApp.close();
    await wait(2000);
    
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await wait(5000);
    
    console.log('Verifying persistence...');
    await expect(window.locator('.hist-panel')).toBeVisible();
    await expect(window.locator('.env-selector').first()).toContainText('External gRPC');
    await expect(window.locator('.address-bar .address-input').first()).toContainText('{{grpc_host}}');
  });

  test('Should import a Postman environment successfully', async () => {
    const postmanEnvFile = join(__dirname, '../mocks/postman-env.json');
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    console.log('Stubbing showOpenDialog in main process...');
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const dialog = params.dialog as any;
      dialog.showOpenDialog = () => Promise.resolve({
        canceled: false,
        filePaths: [filePath]
      }) as any;
    }, postmanEnvFile);
    
    console.log('Opening Environments panel...');
    const envBtn = window.locator('button[data-tooltip="Environments"]').first();
    await envBtn.click();
    await window.waitForSelector('.env-panel', { state: 'visible', timeout: 10000 });
    
    console.log('Clicking Import button...');
    const importBtn = window.locator('button[data-tooltip="Import Postman Environment"]').first();
    await importBtn.click();
    
    console.log('Verifying imported environment exists...');
    const envItem = window.locator('.env-item').filter({ hasText: 'Staging Postman Env' }).first();
    await envItem.waitFor({ state: 'visible', timeout: 10000 });
    
    console.log('Verifying imported variables...');
    await wait(500);
    
    const keyLocators = envItem.locator('.env-var-key');
    const keys = await keyLocators.allTextContents();
    
    // Playwright native inputs use 'value' property
    await expect(envItem.locator('.env-var-key').nth(0)).toHaveValue('STAGING_URL');
    await expect(envItem.locator('.env-var-value').nth(0)).toHaveValue('https://api.staging.example.com');
    
    await expect(envItem.locator('.env-var-key').nth(1)).toHaveValue('API_KEY');
    await expect(envItem.locator('.env-var-value').nth(1)).toHaveValue('stage-key-456');
    
    console.log('Postman import verified successfully.');
  });
});
