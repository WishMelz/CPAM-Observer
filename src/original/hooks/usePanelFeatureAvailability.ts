import { useEffect, useState } from 'react';
import { isUsageServiceId, usageServiceApi } from '@/services/api/usageService';

export type PanelHostMode = 'manager_embedded' | 'external_panel';
export type PanelFeatureUnavailableReason = 'checking' | 'service_not_configured' | 'service_unavailable' | 'monitoring_disabled';
export interface PanelFeatureAvailability {
  checking: boolean;
  panelHostConfirmed: boolean;
  panelHostMode: PanelHostMode;
  panelBase: string;
  managerServiceBase: string;
  managerServiceAvailable: boolean;
  requestMonitoringAvailable: boolean;
  modelPricesAvailable: boolean;
  serverCodexInspectionAvailable: boolean;
  dockerSetupAvailable: boolean;
  externalManagerConfigAvailable: boolean;
  reason: PanelFeatureUnavailableReason | '';
}
const availability: PanelFeatureAvailability = {
  checking: true, panelHostConfirmed: false, panelHostMode: 'manager_embedded',
  panelBase: 'http://viewer.local', managerServiceBase: 'http://viewer.local',
  managerServiceAvailable: false, requestMonitoringAvailable: false,
  modelPricesAvailable: false, serverCodexInspectionAvailable: false,
  dockerSetupAvailable: false, externalManagerConfigAvailable: false, reason: 'checking',
};
let pending: Promise<PanelFeatureAvailability> | undefined;
async function loadAvailability(): Promise<PanelFeatureAvailability> {
  try {
    const [info, response] = await Promise.all([
      usageServiceApi.getInfo(availability.panelBase),
      usageServiceApi.getManagerConfig(availability.managerServiceBase),
    ]);
    if (!isUsageServiceId(info.service)) throw new Error('Unsupported service');
    const connected = Boolean(response.config.cpaConnection?.cpaBaseUrl && response.config.cpaConnection?.managementKeyConfigured);
    const monitoring = connected && response.config.collector?.enabled !== false;
    return { ...availability, checking: false, panelHostConfirmed: true, managerServiceAvailable: true,
      requestMonitoringAvailable: monitoring, modelPricesAvailable: true, serverCodexInspectionAvailable: connected,
      reason: monitoring ? '' : connected ? 'monitoring_disabled' : 'service_not_configured' };
  } catch {
    return { ...availability, checking: false, reason: 'service_unavailable' };
  }
}
export function usePanelFeatureAvailability() {
  const [state, setState] = useState(availability);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!pending) pending = loadAvailability().finally(() => { pending = undefined; });
      void pending.then((result) => { if (active) setState(result); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);
  return state;
}