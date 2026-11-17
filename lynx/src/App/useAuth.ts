import { useCallback, useEffect, useState } from '@lynx-js/react';
import { api, authToken, deviceId, setAuthToken } from '../api.js';
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

  // 固定验证码只在开发环境有意义，取不到就当空（不影响登录本身）
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ code: string; dev: boolean }>('/api/auth/dev-code')
      .then((r) => {
        if (!cancelled && r.dev && r.code) setDevCode(r.code);
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

  const clearError = useCallback(() => setSms((s) => ({ ...s, error: '' })), []);

  return {
    user,
    ready,
    sms,
    sendCode,
    verify,
    logout,
    clearError,
    /** 给登录页的提示文案；生产环境为空串 */
    devHint: devCode ? `测试环境固定验证码：${devCode}` : '',
  };
}
