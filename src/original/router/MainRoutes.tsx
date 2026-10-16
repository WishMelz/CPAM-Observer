import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { UsageAnalyticsPage } from '@/features/usage-analytics/UsageAnalyticsPage';
import { MonitoringCenterPage } from '@/features/monitoring/MonitoringCenterPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';

export function MainRoutes({ location }: { location?: Location; routeBase?: string }) {
  return useRoutes([
    { path: '/usage-analytics', element: <UsageAnalyticsPage /> },
    { path: '/monitoring', element: <MonitoringCenterPage /> },
    { path: '/accounts', element: <AccountsPage /> },
    { path: '*', element: <Navigate to="/usage-analytics" replace /> },
  ], location);
}