import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { fixture, sentinel, viewerKey, upstreamKey } from '../tests/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const translations = JSON.parse(await readFile(new URL('../src/original/i18n/locales/zh-CN.json', import.meta.url), 'utf8'));
const requests = [];
const fixtureErrors = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    requests.push({ method: request.method, path: url.pathname, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(fixture(url.pathname, body, url.searchParams)));
  } catch (error) { fixtureErrors.push(error.message); response.writeHead(500).end(JSON.stringify({ error: sentinel })); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CPA_MANAGER_URL: `http://127.0.0.1:${server.address().port}`, CPA_MANAGER_KEY: upstreamKey, CPAM_VIEWER_KEY: viewerKey, CPAM_COOKIE_SECURE: 'false', CPAM_PUBLIC_ORIGIN: '' },
});
let output = '';
let browser;
app.stdout.on('data', (data) => { output += data; });
app.stderr.on('data', (data) => { output += data; });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Next startup timed out: ${output}`)), 30000);
    app.stdout.on('data', (data) => { if (/Ready in/.test(String(data))) { clearTimeout(timer); resolve(); } });
    app.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Next exited ${code}: ${output}`)); });
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  const leaked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    if (!response.url().includes('/api/')) return;
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    try { const text = await response.text(); if ([sentinel, upstreamKey].some((secret) => text.includes(secret))) leaked.push(response.url()); } catch {}
  });
  const unauthenticated = await context.request.get(`${origin}/api/upstream/v0/management/auth-files`);
  assert.equal(unauthenticated.status(), 401);
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.goto(origin);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page).toHaveTitle('CPAM Observer');
    await expect(page.getByRole('heading', { name: 'CPAM Observer', exact: true })).toBeVisible();
    assert.equal(await page.locator('.viewer-login-form h1').evaluate((heading) => heading.scrollWidth <= heading.clientWidth), true);
    await page.screenshot({ path: new URL(`../test-results/login-${width}.png`, import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('input[type=password]').fill(viewerKey);
  await page.locator('button[type=submit]').click();
  try { await page.locator('a[href="/accounts"]').waitFor(); }
  catch (error) {
    console.log(JSON.stringify({ errors, failed, fixtureErrors, text: await page.locator('body').innerText(), output }, null, 2));
    throw error;
  }
  const cookie = (await context.cookies()).find((entry) => entry.name === 'cpam_observer_session');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  const denied = await context.request.post(`${origin}/api/upstream/v0/management/api-call`, { data: {} });
  assert.equal(denied.status(), 403);
  const crossOrigin = await context.request.post(`${origin}/api/session`, { headers: { Origin: 'https://invalid.test' }, data: { key: viewerKey } });
  assert.equal(crossOrigin.status(), 403);
  const pageNames = { 'usage-analytics': '用量分析', monitoring: '请求监控', accounts: '凭证查询' };
  for (const [route, name] of Object.entries(pageNames)) {
    await page.locator(`a[href="/${route}"]`).click();
    await expect(page).toHaveTitle(`${name} | CPAM Observer`);
    await expect(page.locator('.app-breadcrumb')).toHaveText(name);
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['usage-analytics', 'monitoring', 'accounts']) {
      await page.goto(`${origin}/${route}`);
      await page.locator('a[href="/accounts"]').waitFor({ state: 'attached' });
      await page.waitForLoadState('networkidle');
      const pageName = pageNames[route];
      await expect(page).toHaveTitle(`${pageName} | CPAM Observer`);
      await expect(page.locator(`a[href="/${route}"]`)).toHaveAccessibleName(pageName);
      await expect(page.locator('.app-breadcrumb')).toHaveText(pageName);
      await expect(page.locator('.sidebar-brand')).toHaveAttribute('title', 'CPAM Observer');
      await expect(page.locator('.viewer-brand-name')).toHaveText('CPAMObserver');
      assert.equal(await page.locator('.viewer-brand-name').evaluate((brand) => brand.scrollWidth <= brand.clientWidth && brand.scrollHeight <= brand.clientHeight), true);
      assert.equal(await page.locator('.sidebar-brand-symbol').evaluate((image) => image.complete && image.naturalWidth > 0), true);
      await page.screenshot({ path: new URL(`../test-results/${route}-${width}.png`, import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''), fullPage: true });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, canvases: document.querySelectorAll('canvas').length }));
      console.log(JSON.stringify({ route, width, layout }));
      assert.ok(layout.scroll <= layout.width + 1, `Horizontal overflow: ${route} ${width}`);
      if (route === 'usage-analytics') {
        for (const name of ['趋势分析', '模型分析', '客户端 Key 分析', '凭证分析', '用量热力图', '总览']) {
          await page.getByRole('tab', { name, exact: true }).click();
          await page.waitForLoadState('networkidle');
          await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
        }
        const pixels = await page.locator('canvas').first().evaluate((canvas) => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          return data.some((value, index) => index % 4 === 3 && value > 0);
        });
        assert.equal(pixels, true);
      }
      if (route === 'monitoring') {
        await expect(page.getByRole('button', { name: '导入数据', exact: true })).toHaveCount(0);
        await expect(page.locator('input[type=file]')).toHaveCount(0);
        for (const id of ['apiKeys', 'realtime', 'accounts']) {
          const tab = page.locator(`[role=tab][id$="-${id}"]`);
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        const account = page.locator('button[aria-expanded=false][class*="accountButton"]').first();
        await account.click();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toContainText('75%');
        await expect(page.locator('body')).toContainText('保存的额度快照');
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出数据', exact: true }).click();
        const download = await downloadPromise;
        assert.match(download.suggestedFilename(), /^usage-visible-/);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const exported = Buffer.concat(chunks).toString();
        assert.equal(exported.includes(sentinel), false);
        assert.equal(exported.includes(upstreamKey), false);
      }
      if (route === 'accounts') {
        await expect(page.locator('[data-account-quota-window]').filter({ hasText: '已过期' }).first()).toBeVisible();
        await expect(page.locator('[data-account-quota-window] strong').filter({ hasText: /^-$/ }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /上传文件|粘贴 JSON|批量选择|删除凭证|重新认证/ })).toHaveCount(0);
        await expect(page.locator('input[type=file], [role=switch], [class*="accountPriorityButton"], [class*="accountNoteButton"]')).toHaveCount(0);
        await page.getByRole('button', { name: /^打开 .+ 详情$/ }).first().click();
        await page.getByRole('dialog').waitFor();
        for (const name of ['额度', '配置', '模型', '诊断', '概览']) {
          const tab = page.getByRole('dialog').getByRole('tab', { name, exact: true });
          await tab.click();
          await page.waitForLoadState('networkidle');
          const dialog = page.getByRole('dialog');
          await expect(dialog.getByRole('button', { name: /^(保存|重置|删除|启用|禁用|重新认证|管理全局规则|编辑高级规则|对此凭证禁用)$/ })).toHaveCount(0);
          if (name === '配置') {
            await expect(dialog.getByRole('region', { name: '配置', exact: true })).toBeVisible();
            await expect(dialog.locator('input, textarea, select, [role=switch], [role=combobox]')).toHaveCount(0);
            await dialog.locator('details').last().locator('summary').click();
            await expect(dialog.locator('pre')).toContainText('account-');
          }
        }
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.getByRole('tab', { name: '健康巡检', exact: true }).click();
        await page.getByRole('tab', { name: '本机巡检', exact: true }).click();
        await expect(page.getByRole('button', { name: /开始本机巡检|编辑配置|清空日志|暂停巡检|停止巡检/ })).toHaveCount(0);
        await expect(page.locator('[class*="configOverviewItemShell"] button')).toHaveCount(0);
        await page.getByRole('tab', { name: '服务端巡检', exact: true }).click();
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: /立即服务端巡检|编辑配置|停止巡检|执行处置|重新认证/ })).toHaveCount(0);
        await expect(page.locator('[class*="resultCardList"]')).toContainText('account-1.json');
        await expect(page.locator('[class*="serverResultOperation"] button, [class*="resultsToolbarActions"] button')).toHaveCount(0);
        await page.getByRole('tab', { name: /OAuth/ }).click();
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: /新增禁用|新增别名|编辑|删除规则|更多操作/ })).toHaveCount(0);
        await page.getByRole('button', { name: translations.oauth_model_alias.view_mode_list, exact: true }).click();
        await expect(page.locator('body')).toContainText('viewer-model');
        await page.getByRole('button', { name: translations.oauth_model_alias.view_mode_diagram, exact: true }).click();
        const diagram = page.locator('[class*="aliasChartSection"]');
        await expect(diagram).toContainText('viewer-model');
        await expect(diagram.locator('[draggable=true]')).toHaveCount(0);
        await diagram.getByText('viewer-model', { exact: true }).click({ button: 'right' });
        await expect(page.locator('[class*="contextMenu"]')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    }
  }
  console.log(JSON.stringify({ errors, failed, fixtureErrors, leaked, requests: [...new Set(requests.map((entry) => `${entry.method} ${entry.path}`))] }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(leaked, []);
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(failed, []);
  assert.ok(requests.some((entry) => entry.path.endsWith('/monitoring/analytics')));
  assert.ok(requests.some((entry) => entry.path.endsWith('/auth-files')));
  assert.ok(requests.some((entry) => entry.path.endsWith('/codex-inspection/runs/1')));
  assert.deepEqual(requests.filter((entry) => entry.method !== 'GET' && !(entry.method === 'POST' && /\/(monitoring\/(analytics|account-history|account-window-usage)|quota-snapshots\/query)$/.test(entry.path))), []);
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await page.locator('input[type=password]').waitFor();
  await expect(page).toHaveTitle('CPAM Observer');
  assert.equal((await context.request.get(`${origin}/api/upstream/v0/management/auth-files`)).status(), 401);
  assert.equal(await page.evaluate((key) => Object.values(localStorage).includes(key), viewerKey), false);
  console.log('Browser, session and read-only proxy checks passed.');
} finally {
  await browser?.close();
  app.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}