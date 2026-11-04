import { api } from './api.js';

/**
 * 登录接入层（占位）。
 *
 * 现在没有账号体系：身份就是设备级 clientId，收藏 / 足迹 / 反馈都挂在它上面，行程存在本机。
 * 这里只把「有没有配置登录通道」问清楚，并留出壳层回调的入口，等 AppID 到手再补兑换流程。
 *
 * 刻意不做的事：不再造一个恒为 null 的 user 让界面以为已登录。
 * 界面该显示的是「登录未开放」，而不是「未登录」——两者对用户的含义完全不同。
 */

export type ProviderId = 'wechat' | 'onetap';

export type AuthStatus = {
  /** false 时登录入口直接不显示，不留一个点了就报错的按钮 */
  enabled: boolean;
  providers: { id: ProviderId; label: string; configured: boolean }[];
  /** 'device' = 当前按设备客户端 id 归属数据，没有账号 */
  identity: 'device' | 'account';
};

export const AUTH_OFF: AuthStatus = { enabled: false, providers: [], identity: 'device' };

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const body = await api.get<AuthStatus>('/api/auth/status');
  // 服务端只会在真接通账号后报 account；其余一律按设备身份处理，不乐观假设
  return {
    enabled: !!body.enabled,
    providers: Array.isArray(body.providers) ? body.providers : [],
    identity: body.identity === 'account' ? 'account' : 'device',
  };
}

/** 登录态眼下恒为空：没有 session 表就没有可信的登录态 */
export const LOGGED_IN = null as null;

/** 壳层拿到授权结果后调用；服务端未接通时抛的 ApiError 会被调用方翻成「登录未开放」 */
export async function login(provider: ProviderId, code: string): Promise<never> {
  await api.post('/api/auth/login', { provider, code });
  // 兑换流程未实现时服务端返回 501，上面那行会抛；能走到这里说明契约变了，要重新对齐
  throw new Error('登录兑换返回了未约定的结果');
}

/**
 * 原生壳把授权回调注入到 `globalThis.__fpAuthCallback(code, provider)`。
 * 前端在 App 启动时注册这个回调名对应的处理即可——现在壳还不会调用它。
 */
export type AuthCallback = (provider: ProviderId, payload: { code: string; state?: string }) => void;

export function registerAuthCallback(cb: AuthCallback): () => void {
  const g = globalThis as any;
  g.__fpAuthCallback = (provider: ProviderId, payload: { code: string; state?: string }) => {
    if (!payload || !payload.code) return;
    cb(provider, payload);
  };
  return () => {
    if (g.__fpAuthCallback) delete g.__fpAuthCallback;
  };
}
