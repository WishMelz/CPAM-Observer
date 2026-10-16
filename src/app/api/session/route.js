import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_SECONDS, configuration, equalSecret, issueSession, validSession, sameOrigin, readJson } from '@/server/security.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const attempts = globalThis.__cpamLoginAttempts ??= { since: 0, count: 0 };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const config = configuration();
    const session = (await cookies()).get(COOKIE_NAME)?.value;
    return json({ configured: true, authenticated: validSession(session, config.viewerKey) });
  } catch {
    return json({ configured: false, authenticated: false });
  }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Origin rejected' }, 403);
  let config;
  try { config = configuration(); } catch { return json({ error: 'Server configuration required' }, 503); }
  const now = Date.now();
  if (now - attempts.since > 300_000) { attempts.since = now; attempts.count = 0; }
  if (++attempts.count > 30) return json({ error: 'Too many login attempts. Retry in five minutes.' }, 429);
  let body;
  try { body = await readJson(request, 4096); } catch { return json({ error: 'Invalid request' }, 400); }
  if (typeof body?.key !== 'string' || !equalSecret(body.key, config.viewerKey)) return json({ error: 'Invalid access key' }, 401);
  const response = json({ authenticated: true });
  response.cookies.set(COOKIE_NAME, issueSession(config.viewerKey), {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS,
    secure: process.env.CPAM_COOKIE_SECURE === 'true' || new URL(request.url).protocol === 'https:',
  });
  return response;
}

export async function DELETE(request) {
  if (!sameOrigin(request)) return json({ error: 'Origin rejected' }, 403);
  const response = json({ authenticated: false });
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}