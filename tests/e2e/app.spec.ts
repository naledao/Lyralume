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
  await expect(page.getByRole('heading', { name: '把歌曲拖进来' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择音乐文件夹' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新扫描' })).toHaveCount(0);
  await expect(page.getByText('Lyralume', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '进入沉浸视觉' })).toBeDisabled();
  await expect(page.getByText('音乐文件夹', { exact: true })).toHaveCount(0);
});

test('opens the global task progress page from the sidebar', async () => {
  await page.getByRole('button', { name: '任务进度' }).click();

  await expect(page.getByRole('heading', { name: '任务进度' })).toBeVisible();
  await expect(page.getByText('还没有歌词任务')).toBeVisible();
  await expect(page.getByText(/完成后会通过 Win11 系统通知提醒你/)).toBeVisible();

  await page.getByRole('button', { name: /音乐库/ }).click();
  await expect(page.getByRole('heading', { name: '把歌曲拖进来' })).toBeVisible();
});

test('keeps Node isolated and exposes only the typed preload surface', async () => {
  const boundary = await page.evaluate(() => ({
    requireType: typeof (window as unknown as { require?: unknown }).require,
    processType: typeof (window as unknown as { process?: unknown }).process,
    apiKeys: Object.keys(window.lyralume).sort(),
  }));
  expect(boundary.requireType).toBe('undefined');
  expect(boundary.processType).toBe('undefined');
  expect(boundary.apiKeys).toEqual(['app', 'library', 'lyrics', 'music', 'playback', 'remote', 'settings', 'visuals']);
});

test('opens download, remote music and settings pages', async () => {
  await page.getByRole('button', { name: '搜索下载' }).click();
  await expect(page.getByRole('heading', { name: '搜索与下载' })).toBeVisible();
  await expect(page.getByPlaceholder('输入歌曲名、歌手或关键词')).toBeVisible();
  await expect(page.getByText(/不会自动加入音乐库/)).toBeVisible();

  await page.getByRole('button', { name: '远程音乐' }).click();
  await expect(page.getByRole('heading', { name: '远程音乐' })).toBeVisible();
  await expect(page.getByText('尚未配置 MinIO')).toBeVisible();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByText('全局代理', { exact: true })).toBeVisible();
  await expect(page.getByText('MinIO 音乐同步', { exact: true })).toBeVisible();
  const minioUsername = page.getByLabel('用户名（Access Key）');
  await minioUsername.scrollIntoViewIfNeeded();
  await expect(minioUsername).toBeVisible();
  await expect(page.getByLabel('密码（Secret Key）')).toBeVisible();
  const minioCardBox = await page.locator('.settings-card--minio').boundingBox();
  const minioActionsBox = await page.locator('.settings-card--minio .settings-actions').boundingBox();
  expect(minioCardBox).not.toBeNull();
  expect(minioActionsBox).not.toBeNull();
  expect(minioActionsBox!.y + minioActionsBox!.height).toBeLessThanOrEqual(
    minioCardBox!.y + minioCardBox!.height,
  );
  await expect(page.getByText('YouTube Cookie', { exact: true })).toBeVisible();
  await expect(page.getByText('本地下载运行时', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /音乐库/ }).click();
  await expect(page.getByRole('heading', { name: '把歌曲拖进来' })).toBeVisible();
});

test('keeps a visited page mounted while navigating', async () => {
  const navigation = page.locator('.sidebar__nav button');
  await navigation.nth(2).click();
  const searchInput = page.locator('.online-music-search input');
  await searchInput.fill('keep-alive state');

  await navigation.nth(4).click();
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(searchInput).toBeHidden();

  await navigation.nth(2).click();
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveValue('keep-alive state');

  await navigation.nth(0).click();
});

test('places library status below the heading without covering search', async () => {
  const geometry = await page.evaluate(() => {
    const library = document.querySelector('.library-view');
    const heading = document.querySelector('.library-view__heading');
    const search = document.querySelector('.search-box');
    if (!library || !heading || !search) throw new Error('Library layout was not found');

    const message = document.createElement('div');
    message.className = 'library-message';
    message.textContent = 'A long status message that must not cover the library search field';
    heading.insertAdjacentElement('afterend', message);

    const headingBox = heading.getBoundingClientRect();
    const searchBox = search.getBoundingClientRect();
    const messageBox = message.getBoundingClientRect();
    const overlapsSearch = !(
      messageBox.right <= searchBox.left
      || messageBox.left >= searchBox.right
      || messageBox.bottom <= searchBox.top
      || messageBox.top >= searchBox.bottom
    );
    message.remove();
    return {
      headingBottom: headingBox.bottom,
      messageTop: messageBox.top,
      overlapsSearch,
    };
  });

  expect(geometry.messageTop).toBeGreaterThanOrEqual(geometry.headingBottom);
  expect(geometry.overlapsSearch).toBe(false);
});

test('exposes visual quality and reduced-motion controls', async () => {
  await page.getByRole('button', { name: '视觉设置' }).click();
  await expect(page.getByRole('region', { name: '视觉设置' })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveValue('balanced');
  await expect(page.getByText('减少动态')).toBeVisible();
});

test('uses native window fullscreen for immersive mode and exits with Escape', async () => {
  await page.evaluate(() => window.lyralume.app.setFullscreen(true));

  await expect.poll(() => application.evaluate(({ BrowserWindow }) => (
    {
      fullscreen: BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false,
      alwaysOnTop: BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop() ?? false,
    }
  ))).toEqual({ fullscreen: true, alwaysOnTop: true });
  await expect(page.locator('.immersive-player')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect.poll(() => application.evaluate(({ BrowserWindow }) => (
    {
      fullscreen: BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false,
      alwaysOnTop: BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop() ?? false,
    }
  ))).toEqual({ fullscreen: false, alwaysOnTop: false });
  await expect(page.locator('.immersive-player')).toHaveCount(0);
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
