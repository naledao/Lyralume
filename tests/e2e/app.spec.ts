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
  expect(boundary.apiKeys).toEqual(['app', 'library', 'lyrics', 'playback']);
});

test('keeps lyric layout stable when active styling changes', async () => {
  const measurements = await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.className = 'lyric-lines';
    Object.assign(fixture.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '300px',
    });

    const line = document.createElement('button');
    line.className = 'lyric-line';
    line.dataset.active = 'false';
    line.style.transition = 'none';

    const text = document.createElement('span');
    text.className = 'lyric-line__text lyric-line__text--original';
    text.textContent = '高亮歌词不应该因为字号变化而再换行';
    line.append(text);
    fixture.append(line);
    document.body.append(fixture);

    const inactiveStyle = getComputedStyle(line);
    const inactive = {
      height: line.offsetHeight,
      fontSize: inactiveStyle.fontSize,
      fontWeight: inactiveStyle.fontWeight,
      transform: inactiveStyle.transform,
    };

    line.dataset.active = 'true';
    const activeStyle = getComputedStyle(line);
    const active = {
      height: line.offsetHeight,
      fontSize: activeStyle.fontSize,
      fontWeight: activeStyle.fontWeight,
      transform: activeStyle.transform,
    };

    fixture.remove();
    return { inactive, active };
  });

  expect(measurements.active.height).toBe(measurements.inactive.height);
  expect(measurements.active.fontSize).toBe(measurements.inactive.fontSize);
  expect(measurements.active.fontWeight).toBe(measurements.inactive.fontWeight);
  expect(measurements.active.transform).not.toBe(measurements.inactive.transform);
});
