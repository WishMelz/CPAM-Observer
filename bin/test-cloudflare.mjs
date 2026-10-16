import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixture, sentinel, viewerKey, upstreamKey } from '../tests/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
for (const key of ['CPA_MANAGER_URL', 'CPA_MANAGER_KEY', 'CPAM_VIEWER_KEY', 'CPAM_COOKIE_SECURE', 'CPAM_PUBLIC_ORIGIN']) {
  delete process.env[key];
}
const { unstable_dev } = await import('wrangler');
const compiledEnvironment = await import('../.open-next/cloudflare/next-env.mjs');
for (const mode of ['production', 'development', 'test']) assert.deepEqual(compiledEnvironment[mode], {});
const configuration = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
assert.equal(configuration.keep_vars, true);
assert.equal(configuration.vars, undefined);
const requests = [];
const fixtureErrors = [];
const upstream = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    requests.push({ method: request.method, path: url.pathname, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(fixture(url.pathname, body, url.searchParams)));
  } catch (error) {
    fixtureErrors.push(error.message);
    response.writeHead(500).end(JSON.stringify({ error: sentinel }));
  }
});
const start = (vars) => unstable_dev('.open-next/worker.js', {
  config: 'wrangler.jsonc', envFiles: [], vars, local: true, ip: '127.0.0.1', port: 0,
  inspectorPort: 0, persist: false, logLevel: 'error',
  experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
});
let worker;
try {
  worker = await start({});
  assert.deepEqual(await (await worker.fetch('/api/session')).json(), { configured: false, authenticated: false });
  assert.equal((await worker.fetch('/api/session', { method: 'POST', body: JSON.stringify({ key: viewerKey }) })).status, 503);
  await worker.stop();
  worker = undefined;
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = 'https://viewer.example.test';
  worker = await start({
    CPA_MANAGER_URL: `http://127.0.0.1:${upstream.address().port}`,
    CPA_MANAGER_KEY: upstreamKey, CPAM_VIEWER_KEY: viewerKey,
    CPAM_COOKIE_SECURE: 'true', CPAM_PUBLIC_ORIGIN: origin,
  });
  assert.deepEqual(await (await worker.fetch('/api/session')).json(), { configured: true, authenticated: false });
  assert.equal((await worker.fetch('/api/upstream/v0/management/auth-files')).status, 401);
  const crossOrigin = await worker.fetch('/api/session', {
    method: 'POST', headers: { Origin: 'https://invalid.test' }, body: JSON.stringify({ key: viewerKey }),
  });
  assert.equal(crossOrigin.status, 403);
  const login = await worker.fetch('/api/session', {
    method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ key: viewerKey }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  for (const attribute of [/HttpOnly/i, /SameSite=Strict/i, /Secure/i]) assert.match(cookie, attribute);
  const headers = { Cookie: cookie.split(';')[0], Origin: origin };
  assert.equal((await (await worker.fetch('/api/session', { headers })).json()).authenticated, true);
  const query = await worker.fetch('/api/upstream/v0/management/auth-files', { headers });
  assert.equal(query.status, 200);
  assert.equal(query.headers.get('cache-control'), 'no-store');
  const payload = await query.text();
  assert.equal(JSON.parse(payload).files.length, 15);
  for (const secret of [sentinel, upstreamKey, viewerKey]) assert.equal(payload.includes(secret), false);
  const history = await worker.fetch('/api/upstream/v0/management/monitoring/account-history', {
    method: 'POST', headers, body: JSON.stringify({ accounts: [], catch_up: true }),
  });
  assert.equal(history.status, 200);
  assert.equal(requests.at(-1).body.catch_up, false);
  const count = requests.length;
  for (const path of ['api-call', 'auth-files', 'quota-snapshots/refresh']) {
    const denied = await worker.fetch(`/api/upstream/v0/management/${path}`, {
      method: 'POST', headers, body: '{}',
    });
    assert.equal(denied.status, 403);
  }
  assert.equal(requests.length, count);
  for (const route of ['usage-analytics', 'monitoring', 'accounts']) {
    const page = await worker.fetch(`/${route}`, { headers });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map((match) => match[1]);
    assert.ok(assets.length > 0, `Missing assets on ${route}`);
    for (const asset of new Set(assets)) assert.equal((await worker.fetch(asset)).status, 200);
  }
  const logout = await worker.fetch('/api/session', { method: 'DELETE', headers });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await worker.fetch('/api/upstream/v0/management/auth-files')).status, 401);
  assert.deepEqual(fixtureErrors, []);
  console.log('Workers runtime passed: runtime-only configuration, login/cookies, origin checks, sanitized GET/POST queries, denied writes, pages/assets and logout.');
} finally {
  await worker?.stop();
  if (upstream.listening) await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
}