'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout/MainLayout';
import { AppLifecycle } from '@/app/AppLifecycle';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const router = createBrowserRouter([{ path: '*', element: <MainLayout /> }]);

export default function ViewerClient() {
  const { t } = useTranslation();
  const [session, setSession] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/session', { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (active) setSession(data); })
      .catch(() => { if (active) { setSession({ configured: true, authenticated: false }); setError(i18n.t('viewer.sessionError')); } });
    const logout = () => {
      setKey('');
      setSession((current) => ({ configured: current?.configured ?? true, authenticated: false }));
      void fetch('/api/session', { method: 'DELETE' }).finally(() => window.location.replace('/'));
    };
    window.addEventListener('unauthorized', logout);
    window.addEventListener('viewer-logout', logout);
    return () => { active = false; window.removeEventListener('unauthorized', logout); window.removeEventListener('viewer-logout', logout); };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        setError(t(response.status === 429 ? 'viewer.rateLimit' : response.status === 503 ? 'viewer.configuration' : 'viewer.invalidKey'));
        return;
      }
      setKey('');
      setSession({ configured: true, authenticated: true });
    } catch { setError(t('viewer.connectionError')); }
    finally { setBusy(false); }
  }

  return <>
    <AppLifecycle />
    <NotificationContainer />
    {!session ? <div className="viewer-loading" role="status">{t('common.loading')}</div> : session.authenticated ? <RouterProvider router={router} /> : (
      <main className="viewer-login">
        <form className="viewer-login-form" onSubmit={login}>
          <h1>{t('title.login')}</h1>
          <Input label={t('viewer.accessKey')} type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="current-password" required disabled={busy || !session.configured} />
          {!session.configured ? <p className="viewer-error" role="status">{t('viewer.configuration')}</p> : null}
          {error ? <p className="viewer-error" role="alert">{error}</p> : null}
          <Button type="submit" loading={busy} disabled={!session.configured || busy || !key}>{t('viewer.signIn')}</Button>
        </form>
      </main>
    )}
  </>;
}