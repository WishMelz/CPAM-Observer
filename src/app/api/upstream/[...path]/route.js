import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_NAME, configuration, validSession, sameOrigin, readOnlyRequest, sanitizeResponse, resolveAnalyticsIdentities, readJson } from '@/server/security.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function proxy(request, context) {
  if (!sameOrigin(request)) return json({ error: 'Origin rejected' }, 403);
  let config;
  try { config = configuration(); } catch { return json({ error: 'Server configuration required' }, 503); }
  if (!validSession((await cookies()).get(COOKIE_NAME)?.value, config.viewerKey)) return json({ error: 'Session expired' }, 401);
  const { path: segments } = await context.params;
  const pathname = '/' + segments.join('/');
  if (segments.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) return json({ error: 'Invalid route' }, 403);
  let body;
  try {
    body = readOnlyRequest(request.method, pathname, request.method === 'POST' ? await readJson(request) : undefined);
  } catch {
    return json({ error: 'Read-only: operation not permitted' }, 403);
  }
  const target = new URL(config.base);
  target.pathname = target.pathname.replace(/\/+$/, '') + pathname;
  target.search = new URL(request.url).search;
  if (target.search.length > 8192) return json({ error: 'Query too large' }, 400);
  try {
    if (pathname.endsWith('/monitoring/analytics')) {
      body = await resolveAnalyticsIdentities(body, async (query) => {
        const response = await fetch(target, {
          method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${config.upstreamKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(query),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Identity query failed'); }
        return readJson(response, 32 * 1024 * 1024);
      });
    }
    const upstream = await fetch(target, {
      method: request.method, redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${config.upstreamKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return json({ error: `Manager Server returned HTTP ${upstream.status}` }, upstream.status === 404 ? 404 : 502);
    }
    const data = await readJson(upstream, 32 * 1024 * 1024);
    return json(sanitizeResponse(pathname, data, [config.upstreamKey, config.viewerKey]));
  } catch {
    return json({ error: 'Manager Server unavailable or invalid response' }, 502);
  }
}

export const GET = proxy;
export const POST = proxy;