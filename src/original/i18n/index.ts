/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import { getInitialLanguage } from '@/utils/language';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    en: { translation: en },
    ru: { translation: ru }
  },
  lng: getInitialLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false // React 已经转义
  },
  react: {
    useSuspense: false
  }
});

i18n.addResourceBundle('zh-CN', 'translation', {
  viewer: { stale: '已过期', savedSnapshot: '保存的额度快照', observedAt: '观测时间', snapshotError: '读取额度快照失败，请重试。', accessKey: '访问密钥', signIn: '登录', sessionError: '无法检查登录状态，请刷新重试。',
    rateLimit: '尝试次数过多，请五分钟后重试。', invalidKey: '访问密钥不正确。',
    configuration: '请在服务端配置 CPA_MANAGER_URL、CPA_MANAGER_KEY 和 CPAM_VIEWER_KEY。', connectionError: '连接失败，请重试。' },
}, true, true);
i18n.addResourceBundle('en', 'translation', {
  viewer: { stale: 'Stale', savedSnapshot: 'Saved quota snapshot', observedAt: 'Observed at', snapshotError: 'Unable to read quota snapshots. Please retry.', accessKey: 'Access Key', signIn: 'Sign In', sessionError: 'Unable to check session. Please reload.',
    rateLimit: 'Too many attempts. Retry in five minutes.', invalidKey: 'Invalid access key.',
    configuration: 'Configure CPA_MANAGER_URL, CPA_MANAGER_KEY and CPAM_VIEWER_KEY on the server.', connectionError: 'Connection failed. Please retry.' },
}, true, true);

export default i18n;
