import { create } from 'zustand';

export const useAuthStore = create(() => ({
  isAuthenticated: true,
  apiBase: 'http://viewer.local',
  managementKey: 'cookie-session',
  sessionMode: 'manager_embedded' as const,
  sessionPanelBase: '',
  rememberPassword: false,
  serverVersion: null as string | null,
  serverCommit: null as string | null,
  serverBuildDate: null as string | null,
  supportsPlugin: false,
  connectionStatus: 'connected' as const,
  connectionError: null as string | null,
  logout: () => { window.dispatchEvent(new Event('viewer-logout')); },
}));