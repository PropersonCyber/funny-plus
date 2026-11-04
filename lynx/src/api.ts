import { readLocal, writeLocal } from './storage.js';

/**
 * 后端调用层（原生壳 / web 预览共用）。
 * 地址在构建期注入：`PI_API_BASE=http://192.168.x.x:8787 npm run dev`；
 * 不注入就走相对路径，web 预览由 dev server 的 /api 代理转给 8787。
 *
 * 登录接上后所有请求都要带 token，所以「拼 header」只留这一个入口：
 * 让每个调用点自己塞 Authorization 早晚会漏，尤其是新增的路由。
 */
declare const __API_BASE__: string;
const BASE = typeof __API_BASE__ === 'string' ? __API_BASE__ : '';
const TIMEOUT_MS = 8000;

export class ApiError extends Error {}

type Init = { method?: string; body?: string; headers?: Record<string, string> };

const TOKEN_KEY = 'funny-plus.auth-token.v1';

/** 现在恒为空（没有账号体系）；登录接通后从本机存储取，调用点不用改 */
export function authToken(): string {
  return readLocal(TOKEN_KEY) ?? '';
}

export function setAuthToken(token: string): void {
  writeLocal(TOKEN_KEY, token);
}

async function request<T>(path: string, init?: Init): Promise<T> {
  // 宿主没给 AbortController 时就只能靠后端超时，不因此直接失败
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const token = authToken();
    const headers = {
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    // 显式给 HeadersInit 类型：对象字面量里的 authorization 会被推成 string，和 fetch 的签名对不上
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: headers as Record<string, string>,
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body && typeof body.error === 'string' && body.error ? body.error : `请求失败（${res.status}）`;
      throw new ApiError(msg);
    }
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

const CLIENT_KEY = 'funny-plus.client-id.v1';

/**
 * 设备标识：只用于「同一台设备同一条只记一次」。
 * 本机存储拿不到时退回会话内随机 id —— 这会让重启后又被算成新设备，
 * 所以界面上要照实说「只在本次会话有效」，不能假装已长期去重。
 */
let sessionId = '';

export function deviceId(): string {
  const saved = readLocal(CLIENT_KEY);
  if (saved) return saved;
  if (!sessionId) sessionId = `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  writeLocal(CLIENT_KEY, sessionId);
  return sessionId;
}
