import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, equalSecret, issueSession, validSession, readOnlyRequest, sanitize, sanitizeResponse, resolveAnalyticsIdentities, hash, sameOrigin, readJson } from '../src/server/security.mjs';

const key = 'AbCdEf';
test('configuration requires independent keys and a fixed upstream URL', () => {
  assert.throws(() => configuration({}));
  assert.throws(() => configuration({ CPA_MANAGER_URL: 'https://example.test', CPA_MANAGER_KEY: key, CPAM_VIEWER_KEY: key }));
  assert.throws(() => configuration({ CPA_MANAGER_URL: 'https://user:pass@example.test', CPA_MANAGER_KEY: 'upstream', CPAM_VIEWER_KEY: key }));
  assert.equal(configuration({ CPA_MANAGER_URL: 'https://example.test/prefix', CPA_MANAGER_KEY: 'upstream', CPAM_VIEWER_KEY: key }).base.pathname, '/prefix');
});
test('viewer keys contain exactly six English letters without normalization', () => {
  const env = { CPA_MANAGER_URL: 'https://example.test', CPA_MANAGER_KEY: 'upstream' };
  for (const viewerKey of ['abcdef', 'ABCDEF', key]) {
    assert.equal(configuration({ ...env, CPAM_VIEWER_KEY: viewerKey }).viewerKey, viewerKey);
  }
  for (const viewerKey of [undefined, '', 'abcde', 'abcdefg', 'a'.repeat(24), 'abcde1', 'abcde!', ' abcde', 'abcde ', 'abcdef\n', 'abcdef\r\n', '\u00e9bcdef', '\u4e2dbcdef']) {
    assert.throws(() => configuration({ ...env, CPAM_VIEWER_KEY: viewerKey }), /exactly 6 English letters/);
  }
});
test('sessions expire, resist forgery and rotate with the viewer key', () => {
  const now = Date.now();
  const token = issueSession(key, now);
  assert.equal(validSession(token, key, now), true);
  assert.equal(validSession(token, key, now + 8 * 3600 * 1000), false);
  assert.equal(validSession(`${token}0`, key, now), false);
  assert.equal(validSession(token, 'XyZaBc', now), false);
  assert.equal(validSession(token, key.toLowerCase(), now), false);
  assert.equal(equalSecret(key, key), true);
  assert.equal(equalSecret(key, 'wrong'), false);
});
test('only explicit query routes pass, never writes or active probes', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.throws(() => readOnlyRequest(method, '/v0/management/auth-files'));
  for (const path of ['/v0/management/api-call', '/v0/management/auth-files', '/v0/management/quota-snapshots', '/v0/management/codex-inspection/run', '/setup']) assert.throws(() => readOnlyRequest('POST', path, {}));
  for (const path of ['/v0/management/get-auth-status', '//example.test', '/v0/management/auth-files/../api-call', '/v0/management/config.yaml']) assert.throws(() => readOnlyRequest('GET', path));
  assert.equal(readOnlyRequest('GET', '/v0/management/codex-inspection/runs/42'), undefined);
  assert.equal(readOnlyRequest('GET', '/v0/management/model-prices/runtime-models'), undefined);
  assert.equal(readOnlyRequest('GET', '/v0/management/model-definitions/claude'), undefined);
  assert.throws(() => readOnlyRequest('POST', '/v0/management/model-definitions/claude', {}));
  assert.equal(readOnlyRequest('POST', '/v0/management/monitoring/account-history', { accounts: [], catch_up: true }).catch_up, false);
  assert.deepEqual(readOnlyRequest('POST', '/v0/management/monitoring/analytics', { limit: 20 }), { limit: 20 });
});
test('responses never contain configured secrets or credential tokens', () => {
  const result = sanitize({ files: [{ email: 'account@example.test', access_token: 'private', refresh_token: 'private', nested: { headers: { Authorization: 'private' }, note: 'contains admin-secret' } }], 'api-keys': ['private-api-key'] }, ['admin-secret']);
  const text = JSON.stringify(result);
  assert.equal(text.includes('private'), false);
  assert.equal(text.includes('admin-secret'), false);
  assert.equal(result.files[0].email, 'account@example.test');
  assert.equal(result['api-keys'][0].length, 64);
});
test('rejects cross-origin requests and oversized JSON', async () => {
  assert.equal(sameOrigin(new Request('https://viewer.test/api', { headers: { origin: 'https://evil.test' } })), false);
  assert.equal(sameOrigin(new Request('https://viewer.test/api', { headers: { origin: 'https://viewer.test' } })), true);
  assert.equal(sameOrigin(new Request('http://localhost:3000/api', { headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } })), true);
  assert.equal(sameOrigin(new Request('http://localhost:3000/api', { headers: { host: '127.0.0.1:3000', origin: 'https://evil.test' } })), false);
  await assert.rejects(readJson(new Request('https://viewer.test/api', { method: 'POST', body: JSON.stringify({ long: 'value' }) }), 5));
  assert.deepEqual(await readJson(new Request('https://viewer.test/api', { method: 'POST', body: '{"ok":true}' })), { ok: true });
});

test('analytics identities are opaque and sources cannot leak through nested contexts', () => {
  const rawId = 'credential:' + Buffer.from('private-source').toString('hex');
  const result = sanitizeResponse('/v0/management/monitoring/analytics', {
    credential_stats: [{ id: rawId, source: 'private-source', source_hash: hash('private-source') }],
    api_key_stats: [{ id: 'private-source', contexts: [{ id: rawId, sources: ['private-source'] }] }],
  });
  assert.equal(result.credential_stats[0].id, hash(rawId));
  assert.equal(result.api_key_stats[0].contexts[0].id, hash(rawId));
  assert.equal(JSON.stringify(result).includes('private-source'), false);
  assert.equal(JSON.stringify(result).includes(Buffer.from('private-source').toString('hex')), false);
});

test('saved token claims preserve account and plan without exporting credentials', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ chatgpt_account_id: 'workspace-id', chatgpt_plan_type: 'team', chatgpt_subscription_active_until: 2000000000, sub: 'private-subject', access_token: 'private-token' })).toString('base64url') + '.signature';
  const result = sanitizeResponse('/v0/management/auth-files', { files: [{ id_token: token, access_token: 'unusual-provider-key', note: 'value unusual-provider-key' }] });
  assert.deepEqual(result.files[0].id_token, { chatgpt_account_id: 'workspace-id', chatgpt_plan_type: 'team', chatgpt_subscription_active_until: 2000000000 });
  assert.equal(JSON.stringify(result).includes('unusual-provider-key'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('credential trend selection resolves only against the same filtered upstream data', async () => {
  const body = { from_ms: 1, to_ms: 2, filters: { models: ['test-model'], credential_ids: [hash('raw-id')] }, include: { credential_timeline: true } };
  const resolved = await resolveAnalyticsIdentities(body, async (query) => {
    assert.deepEqual(query.filters, { models: ['test-model'] });
    assert.deepEqual(query.include, { credential_stats: true });
    return { credential_stats: [{}, { id: 'raw-id' }] };
  });
  assert.deepEqual(resolved.filters.credential_ids, ['raw-id']);
  await assert.rejects(resolveAnalyticsIdentities(body, async () => ({ credential_stats: [] })));
  assert.deepEqual(body.filters.credential_ids, [hash('raw-id')]);
});

test('business keys and quota evidence sources survive without exposing credential keys', () => {
  const analytics = sanitizeResponse('/v0/management/monitoring/analytics', { heatmap: [{ model_contributors: [{ key: 'gpt-5.4', source: 'private' }] }] });
  assert.deepEqual(analytics.heatmap[0].model_contributors, [{ key: 'gpt-5.4' }]);
  assert.equal(sanitizeResponse('/v0/management/openai-compatibility', { entries: [{ key: 'private' }] }).entries[0].key, hash('private'));
  const quota = sanitizeResponse('/v0/management/quota-snapshots/query', { windows: [{ source: 'api_query' }, { source: 'private' }] });
  assert.deepEqual(quota.windows, [{ source: 'api_query' }, {}]);
});

test('nested public claims preserve identity and repeated provider secrets are redacted', () => {
  const result = sanitizeResponse('/v0/management/auth-files', {
    files: [{ key: 'opaque-private-credential', note: 'value opaque-private-credential',
      proxy_url: 'https://user:password@proxy.test',
      id_token: { 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace', access_token: 'private-token' },
        'https://api.openai.com/profile': { email: 'member@example.test', sub: 'private-subject' } } }],
  });
  assert.equal(result.files[0].id_token['https://api.openai.com/auth'].chatgpt_account_id, 'workspace');
  assert.equal(result.files[0].id_token['https://api.openai.com/profile'].email, 'member@example.test');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('password'), false);
});

test('HTTPS reverse proxies require an explicit trusted public origin', () => {
  const request = new Request('http://localhost:3000/api', { headers: { origin: 'https://viewer.test', host: 'internal:3000' } });
  assert.equal(sameOrigin(request, 'https://viewer.test'), true);
  assert.equal(sameOrigin(request, 'https://other.test'), false);
  assert.equal(sameOrigin(request, 'https://viewer.test/not-an-origin'), false);
  assert.equal(sameOrigin(request, ''), false);
});