import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Debug Page Object', () => {
  let electronApp: any;
  let page: any;

  test('debug page', async () => {
    const userDataDir = join(__dirname, '../../test-user-data-debug');
    electronApp = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    page.on('dialog', async (dialog: any) => {
      console.log('Dialog caught:', dialog.message());
      await dialog.accept('debug-folder');
    });
    
    const result = await page.evaluate(() => window.prompt('test prompt'));
    console.log('Prompt result:', result);
    await electronApp.close();
  });
});
