import { useCallback, useEffect, useState } from '@lynx-js/react';
import { api, authToken, deviceId, setAuthToken } from '../api.js';
import { onHostAuth, takeHostAuth } from '../hostBridge.js';
import type { HostAuth } from '../hostBridge.js';
import { track } from '../track.js';

/**
 * 登录态（F06）。
 *
 * 三个刻意的选择：
 *
 * 1. **token 只信服务端**。本机存的 token 在启动时拿 `/api/auth/me` 验一次，验不过就当
 *    未登录。直接信本机 token 会让「换设备 / 服务端已吊销」后界面仍显示已登录，
 *    而所有云端请求都 401 —— 那种「看起来登着、实际什么都没保存」最伤。
 * 2. **匿名是一等状态，不是错误**。`user` 为 null 时所有云端调用直接跳过，
 *    不弹登录、不报错。产品口径是登录只挡云同步，不挡浏览与规划。
 * 3. **登录失败不清已有登录态**。换号失败时保留原账号，避免「点错了反而被登出」。
 */

export type AccountUser = {
  id: string;
  phone: string | null;
  createdAt: string;
};

// 通道展示规则与类型放在 authProviders.ts：纯函数才能单独测，
// 而这个文件含 hooks，测试里 import 它会触发 React transform 失败
export { visibleProviders } from '../authProviders.js';
export type { AuthProvider } from '../authProviders.js';
import type { AuthProvider } from '../authProviders.js';

type SmsState = {
  /** 秒；>0 时发送按钮应禁用并显示倒计时 */
  cooldown: number;
  sending: boolean;
  verifying: boolean;
  /** 最近一次错误文案，供界面直接显示 */
  error: string;
};

const IDLE_SMS: SmsState = { cooldown: 0, sending: false, verifying: false, error: '' };

/** 手机号脱敏：138****8000。展示用，不参与任何判断 */
export function maskPhone(phone: string | null): string {
  if (!phone) return '';
  if (phone.length !== 11) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

/** 归一化手机号；非法返回空串。前端先拦一次，省一次必然失败的请求 */
export function normalizePhoneInput(phone: string): string {
  const digits = phone.replace(/[\s-]/g, '').replace(/^\+?86/, '');
  return /^1[3-9]\d{9}$/.test(digits) ? digits : '';
}

export function useAuth() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sms, setSms] = useState<SmsState>(IDLE_SMS);
  /** 非生产环境由服务端下发固定验证码；生产恒为空串 */
  const [devCode, setDevCode] = useState('');
  /**
   * 三方通道的就绪状态。
   *
   * 默认空数组而不是「全部显示」：凭证明明没配却先渲染出按钮，用户点下去才收到 501，
   * 是最差的一种「不知道自己撞了什么」。所以拿到服务端答复之前，一个都不显示。
   */
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  /** 三方登录进行中：只能在拉起授权页期间为真，避免用户连点两次 */
  const [providerBusy, setProviderBusy] = useState<string>('');
  const [providerError, setProviderError] = useState('');

  // 启动时验一次本机 token：验过才算登录，避免「看起来登着、实际全 401」
  useEffect(() => {
    let cancelled = false;
    const token = authToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .get<{ user: AccountUser }>('/api/auth/me')
      .then((r) => {
        if (!cancelled) setUser(r.user);
      })
      .catch(() => {
        // 401 时 api 层已清掉 token；这里只需把状态归零
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 固定验证码只在开发环境有意义，取不到就当空（不影响登录本身）。
  // 服务端在生产直接 404，所以「拿到了 code」本身就说明是开发环境 ——
  // 上一版还去判断响应里的 `dev` 字段，而服务端根本不下发它，提示永远不显示。
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ code?: string }>('/api/auth/dev-code')
      .then((r) => {
        if (!cancelled && r.code) setDevCode(r.code);
      })
      .catch(() => {
        // 生产环境本来就没有，静默忽略
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 倒计时：放 useEffect 而不是每次渲染都减，否则界面刷新频率等于渲染频率
  useEffect(() => {
    if (sms.cooldown <= 0) return;
    const t = setTimeout(() => setSms((s) => ({ ...s, cooldown: Math.max(0, s.cooldown - 1) })), 1000);
    return () => clearTimeout(t);
  }, [sms.cooldown]);

  /**
   * 拉一次通道状态。登录页打开时问一次就够，凭证不是每次登录都会变。
   *
   * 失败时保持空数组（= 不显示三方按钮），而不是退回「全部显示」：
   * 网络不通时宁可让用户看不到按钮，也不要给他一个点了必然失败的入口。
   */
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ providers?: AuthProvider[] }>('/api/auth/status')
      .then((r) => {
        if (!cancelled) setProviders(Array.isArray(r.providers) ? r.providers : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendCode = useCallback(async (phone: string): Promise<boolean> => {
    const digits = normalizePhoneInput(phone);
    if (!digits) {
      setSms((s) => ({ ...s, error: '手机号格式不对' }));
      return false;
    }
    setSms((s) => ({ ...s, sending: true, error: '' }));
    try {
      const r = await api.post<{ ok: boolean; cooldown: number }>('/api/auth/sms-code', { phone: digits });
      setSms((s) => ({ ...s, sending: false, cooldown: r.cooldown || 60 }));
      track('login_sms_sent');
      return true;
    } catch (e) {
      setSms((s) => ({ ...s, sending: false, error: e instanceof Error ? e.message : '发送失败' }));
      return false;
    }
  }, []);

  const verify = useCallback(async (phone: string, code: string): Promise<boolean> => {
    const digits = normalizePhoneInput(phone);
    setSms((s) => ({ ...s, verifying: true, error: '' }));
    try {
      // clientId 必须带：服务端靠它把本机匿名数据静默并到账号下
      const r = await api.post<{ token: string; user: AccountUser }>('/api/auth/sms-verify', {
        phone: digits,
        code,
        clientId: deviceId(),
      });
      setAuthToken(r.token);
      setUser(r.user);
      setSms(IDLE_SMS);
      track('login_success');
      return true;
    } catch (e) {
      setSms((s) => ({ ...s, verifying: false, error: e instanceof Error ? e.message : '验证码不正确' }));
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // 服务端失败也要清本机：用户点了退出就该退出，残留 token 只会让状态更乱
    }
    setAuthToken('');
    setUser(null);
    track('logout');
  }, []);

  /**
   * 用凭证兑换登录（微信 code / Apple identityToken）。
   *
   * 抽成单独一个函数而不是塞进 useCallback 里：回跳路径（壳推 code）和
   * 按钮路径（用户点按钮后壳拉起授权）最终都调它，两条路必须走同一段代码 ——
   * 各写一遍必然有一处漏掉 clientId 或错误处理。
   */
  const exchange = useCallback(async (provider: string, code: string): Promise<boolean> => {
    const id = provider === 'apple' ? 'apple' : 'wechat';
    setProviderBusy(id);
    setProviderError('');
    try {
      // clientId 与短信登录一致：服务端靠它把本机匿名数据并到账号下
      const r = await api.post<{ token: string; user: AccountUser }>('/api/auth/login', {
        provider: id,
        code,
        clientId: deviceId(),
      });
      setAuthToken(r.token);
      setUser(r.user);
      track('login_success', { via: id });
      return true;
    } catch (e) {
      // 未配置 / 凭证失效 / 网络：都如实显示，不假装成功
      setProviderError(e instanceof Error ? e.message : '登录失败');
      return false;
    } finally {
      setProviderBusy('');
    }
  }, []);

  /**
   * 拉起三方授权。
   *
   * 真正的授权页在原生壳里（微信 WXApi / Apple ASAuthorizationController），
   * JS 侧只能「请求壳去拉」。壳通过 globalProps 写回 `__fpAuth`，由下面的 effect 消费。
   *
   * 三种结局都要说真话：
   * - 壳没有这个桥（web 预览 / 老版本壳）→ 明说环境不支持
   * - 桥返回 false（壳装了但 SDK 没接）→ 明说这条通道还没就绪
   * - 桥抛错 → 把原因透出来
   * 只有真的拉起来了才清掉错误。任何一种都**不**假装已发出请求。
   */
  const startProviderLogin = useCallback(async (provider: string): Promise<boolean> => {
    const bridge = (globalThis as { __fpStartAuth?: (p: string) => boolean | void }).__fpStartAuth;
    if (typeof bridge !== 'function') {
      setProviderError('当前环境还不支持这个登录方式，请先用手机号登录');
      return false;
    }
    setProviderBusy(provider);
    setProviderError('');
    try {
      // 同步返回 false = 壳明确说「这条通道我拉不起来」（SDK 未接）。
      // 不把这种情况当成「已拉起」——否则界面会一直转圈，用户不知道发生了什么
      const started = bridge(provider);
      if (started === false) {
        setProviderBusy('');
        setProviderError('这个登录方式还没开通，请先用手机号登录');
        return false;
      }
      // 授权页回来后由 __fpAuth → effect → exchange 接手；这里不 await 结果
      return true;
    } catch (e) {
      setProviderBusy('');
      setProviderError(e instanceof Error ? e.message : '无法拉起授权');
      return false;
    }
  }, []);

  // 壳推来回跳凭证时兑换。
  // 两个入口都要：挂载时读一次（用户从授权页回来，App 冷启动进登录页），
  // 以及订阅后续推送（页面已经开着，用户才完成授权）—— 只做前者会漏掉后者。
  useEffect(() => {
    const fire = (cb: HostAuth | null) => {
      if (!cb) return;
      const code = typeof cb.code === 'string' ? cb.code : '';
      const provider = typeof cb.provider === 'string' ? cb.provider : 'wechat';
      if (code) void exchange(provider, code);
    };
    fire(takeHostAuth());
    return onHostAuth((cb) => fire(takeHostAuth() ?? cb));
  }, [exchange]);

  const clearError = useCallback(() => setSms((s) => ({ ...s, error: '' })), []);

  return {
    user,
    ready,
    sms,
    sendCode,
    verify,
    logout,
    clearError,
    /** 已配置的三方通道；空数组 = 服务端没配或还没问到，界面不显示按钮 */
    providers,
    /** 正在拉起的通道 id；空串表示没有进行中的请求 */
    providerBusy,
    providerError,
    startProviderLogin,
    clearProviderError: () => setProviderError(''),
    /** 给登录页的提示文案；生产环境为空串 */
    devHint: devCode ? `测试环境固定验证码：${devCode}` : '',
  };
}
