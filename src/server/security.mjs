import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'cpam_observer_session';
export const SESSION_SECONDS = 8 * 60 * 60;

export function configuration(env = process.env) {
  const base = new URL(env.CPA_MANAGER_URL || 'http://unconfigured.invalid');
  const upstreamKey = env.CPA_MANAGER_KEY || '';
  const viewerKey = env.CPAM_VIEWER_KEY || '';
  if (!env.CPA_MANAGER_URL || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid CPA_MANAGER_URL');
  if (!upstreamKey || viewerKey.length < 6 || /[^A-Za-z]/.test(viewerKey) || equalSecret(upstreamKey, viewerKey)) throw new Error('Configure separate CPA_MANAGER_KEY and CPAM_VIEWER_KEY (at least 6 English letters)');
  return { base, upstreamKey, viewerKey };
}

export function equalSecret(left, right) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(left), digest(right));
}

export function issueSession(key, now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString('hex')}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('hex')}`;
}

export function validSession(token, key, now = Date.now()) {
  if (!key || typeof token !== 'string' || !/^\d+\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, signature] = token.split('.');
  const current = Math.floor(now / 1000);
  return Number(expires) > current && Number(expires) <= current + SESSION_SECONDS && equalSecret(signature, createHmac('sha256', key).update(`${expires}.${nonce}`).digest('hex'));
}

const getPaths = new Set([
  '/usage-service/info', '/usage-service/config', '/usage-service/account-processing-policy',
  '/usage-service/quota-cooldowns', '/status',
  '/v0/management/config', '/v0/management/auth-files', '/v0/management/auth-files/models',
  '/v0/management/auth-files/download', '/v0/management/oauth-excluded-models',
  '/v0/management/oauth-model-alias', '/v0/management/models', '/v0/management/api-keys',
  '/v0/management/gemini-api-key', '/v0/management/claude-api-key', '/v0/management/codex-api-key',
  '/v0/management/vertex-api-key', '/v0/management/openai-compatibility',
  '/v0/management/model-prices', '/v0/management/api-key-aliases',
  '/v0/management/model-prices/runtime-models',
  '/v0/management/monitoring/header-snapshots', '/v0/management/codex-inspection/runs',
  '/v0/management/account-action-candidates', '/v0/management/usage',
]);
const postPaths = new Set([
  '/v0/management/monitoring/analytics', '/v0/management/monitoring/account-history',
  '/v0/management/monitoring/account-window-usage', '/v0/management/quota-snapshots/query',
]);

export function readOnlyRequest(method, path, input) {
  if (method === 'GET' && (getPaths.has(path) || /^\/v0\/management\/codex-inspection\/runs\/\d+$/.test(path) || /^\/v0\/management\/model-definitions\/(codex|claude|gemini|antigravity|kimi|qwen|iflow|xai|devin|meta|vertex|openai-compatibility)$/.test(path))) return undefined;
  if (method !== 'POST' || !postPaths.has(path)) throw new Error('Read-only endpoint denied');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a query object');
  return path.endsWith('/account-history') ? { ...input, catch_up: false } : input;
}

const secretField = /^(access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|cookie|set-cookie|password|secret|client[-_]?secret|management[-_]?key|api[-_]?key|token|headers|request_body|response_body|raw_body|rawJson|raw|source|sources|proxy[-_]?url)$/i;
export const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

function publicTokenClaims(value) {
  let payload = value;
  if (typeof value === 'string') {
    try { payload = JSON.parse(value); } catch {
      try { payload = JSON.parse(Buffer.from(value.split('.')[1] || '', 'base64url').toString('utf8')); } catch { return undefined; }
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const allowed = /^(chatgpt_account_id|chatgptAccountId|account_id|accountId|plan_type|planType|chatgpt_plan_type|chatgpt_subscription_active_until|chatgptSubscriptionActiveUntil|email)$/;
  return Object.fromEntries(Object.entries(payload).flatMap(([name, entry]) => {
    if (allowed.test(name) && ['string', 'number'].includes(typeof entry)) return [[name, entry]];
    if (['https://api.openai.com/auth', 'https://api.openai.com/profile'].includes(name)) {
      const nested = publicTokenClaims(entry);
      return nested ? [[name, nested]] : [];
    }
    return [];
  }));
}

export function responseSecrets(value, secrets = [], credentialKeys = false) {
  const collected = new Set(secrets.filter(Boolean));
  const visit = (entry, field = '') => {
    if (typeof entry === 'string') {
      if ((secretField.test(field) || /^api[-_]?keys$/i.test(field) || (credentialKeys && field === 'key')) && !/^(source|sources)$/i.test(field) && entry.length >= 4) collected.add(entry);
    } else if (Array.isArray(entry)) entry.forEach((item) => visit(item, field));
    else if (entry && typeof entry === 'object') Object.entries(entry).forEach(([name, item]) => visit(item, name));
  };
  visit(value);
  return [...collected].sort((left, right) => right.length - left.length);
}

export function sanitize(value, secrets = [], field = '', options = {}) {
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, secrets, field, options));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([name, entry]) => {
      if (/^id[-_]?token$/i.test(name)) {
        const claims = publicTokenClaims(entry);
        return claims ? [[name, sanitize(claims, secrets, '', options)]] : [];
      }
      if ((/^api[-_]?key$/i.test(name) || (name === 'key' && options.credentialKeys)) && typeof entry === 'string') return [[name, hash(entry)]];
      if (name === 'source' && options.quotaSources && ['api_query', 'response_header', 'response_body', 'inspection'].includes(entry)) return [[name, entry]];
      if (secretField.test(name)) return [];
      return [[sanitize(name, secrets), sanitize(entry, secrets, name, options)]];
    }));
  }
  if (typeof value !== 'string') return value;
  if (/^(api-keys|api_keys|apiKeys|keys)$/.test(field)) return hash(value);
  let result = value;
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[REDACTED]');
  return result.replace(/\bBearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

export function sameOrigin(request, publicOrigin = process.env.CPAM_PUBLIC_ORIGIN) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  if (!origin) return true;
  if (publicOrigin) {
    try {
      const configured = new URL(publicOrigin);
      if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) return false;
      return origin === configured.origin;
    } catch { return false; }
  }
  const url = new URL(request.url);
  const host = request.headers.get('host');
  return origin === url.origin || Boolean(host && origin === `${url.protocol}//${host}`);
}

export async function readJson(request, limit = 1024 * 1024) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing JSON');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('Request too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function sanitizeResponse(pathname, value, secrets = []) {
  const credentialKeys = /\/(config|auth-files|download|[a-z-]+-api-key|openai-compatibility)$/.test(pathname);
  const result = sanitize(value, responseSecrets(value, secrets, credentialKeys), '', {
    credentialKeys,
    quotaSources: pathname.endsWith('/quota-snapshots/query'),
  });
  if (pathname === '/usage-service/config' && result.config?.cpaConnection) {
    result.config.cpaConnection.managementKeyConfigured = Boolean(value.config?.cpaConnection?.managementKeyConfigured || value.config?.cpaConnection?.managementKey);
  }
  if (pathname.endsWith('/monitoring/analytics')) {
    const identities = (raw, safe) => {
      if (Array.isArray(raw)) return raw.map((entry, index) => identities(entry, safe[index]));
      if (!raw || typeof raw !== 'object') return safe;
      return Object.fromEntries(Object.entries(safe).map(([name, entry]) => [name, name === 'id' && typeof raw[name] === 'string' ? hash(raw[name]) : identities(raw[name], entry)]));
    };
    return identities(value, result);
  }
  return result;
}

export async function resolveAnalyticsIdentities(body, query) {
  const ids = body?.filters?.credential_ids;
  if (!ids?.length) return body;
  if (!Array.isArray(ids) || ids.length > 40 || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid credential identifiers');
  const filters = { ...body.filters };
  delete filters.credential_ids;
  const response = await query({ ...body, filters, include: { credential_stats: true } });
  const index = new Map((response.credential_stats || []).filter((row) => typeof row.id === 'string').map((row) => [hash(row.id), row.id]));
  if (ids.some((id) => !index.has(id))) throw new Error('Credential selection no longer available');
  return { ...body, filters: { ...body.filters, credential_ids: ids.map((id) => index.get(id)) } };
}