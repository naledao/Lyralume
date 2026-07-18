import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let application: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'lyralume-e2e-'));
  application = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LYRALUME_E2E_USER_DATA: userDataDirectory,
    },
  });
  page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await application?.close();
  if (userDataDirectory) await rm(userDataDirectory, { recursive: true, force: true });
});

test('starts with an empty, usable local library', async () => {
  await expect(page.getByRole('heading', { name: '从你的音乐文件夹开始' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择音乐文件夹' }).first()).toBeVisible();
  await expect(page.getByText('Lyralume', { exact: true }).first()).toBeVisible();
});

test('keeps Node isolated and exposes only the typed preload surface', async () => {
  const boundary = await page.evaluate(() => ({
    requireType: typeof (window as unknown as { require?: unknown }).require,
    processType: typeof (window as unknown as { process?: unknown }).process,
    apiKeys: Object.keys(window.lyralume).sort(),
  }));
  expect(boundary.requireType).toBe('undefined');
  expect(boundary.processType).toBe('undefined');
  expect(boundary.apiKeys).toEqual(['app', 'library', 'lyrics']);
});
