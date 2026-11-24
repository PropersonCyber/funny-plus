/**
 * 宿主（原生壳 / web 容器）下发数据的唯一落点。
 *
 * 为什么要有这一层：Lynx 的 globalProps 在业务代码里**拿不到**。
 * 实测原生 Lynx 和 web 渲染器两种情况下，`globalThis.lynx` 都是 undefined，
 * 所以 `lynx.__globalProps.__fpXxx` 这条路根本走不通 —— 之前 geo.ts 和 api.ts
 * 各自去读它，结果一个永远定位失败、一个 BASE 变成空串。
 *
 * 官方给的读取入口是 React 层的 `useGlobalProps()`，只能在组件里调。
 * 因此由 App 根组件把它交给 setHostProps()，其余模块从这里取。
 * 放在独立文件是为了让 geo.ts 和 api.ts 都能引用而不产生循环依赖。
 */

export type HostLocation = {
  lng?: unknown;
  lat?: unknown;
  accuracy?: unknown;
  at?: unknown;
  error?: unknown;
};

let location: HostLocation | null = null;
let apiBase = '';
/** 宿主自报的端标识；没自报就按「有没有原生同步桥」推断，见 hostPlatform() */
let platform = '';

/**
 * 分享页 token。
 *
 * 分享页由服务端外壳注入 `__fpShareToken`（见 server/src/routes/shareShell.ts），
 * 走的是与定位、`__fpApiBase` 完全相同的 globalProps 通道 —— 原生 Lynx 与 web 渲染器
 * 都拿不到 `globalThis.lynx`，只有 React 层的 `useGlobalProps()` 能读到。
 */
let shareToken = '';

/**
 * 三方登录回跳（F06）。
 *
 * iOS 壳把 `funnyplus://auth?provider=wechat&code=xxx` 解析后写进 globalProps 的
 * `__fpAuth`（见 HostBridge.handle）。这里只是落一下，真正的兑换由 useAuth 做 ——
 * 分成两层是因为「壳拿到了 code」和「登录成功」是两件事，中间还要过一次服务端。
 *
 * 带 `at` 时间戳：同一个 code 被重复投递（壳重放 globalProps）时，靠它判断是不是新的，
 * 否则用户成功登录后又会被同一个 code 再登一次。
 */
export type HostAuth = { provider?: unknown; code?: unknown; at?: unknown };

let authCallback: HostAuth | null = null;

/**
 * 回跳凭证的订阅者。
 *
 * 凭证是壳异步推上来的（用户授权 → 回跳 → 壳写 globalProps），
 * 只在挂载时读一次会漏掉「页面已经开着，用户才完成授权」这种最常见的情形。
 * 用订阅而不是轮询：轮询要么太密费电，要么太疏让用户等。
 */
const authListeners = new Set<(auth: HostAuth) => void>();

export function onHostAuth(fn: (auth: HostAuth) => void): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

/** App 根组件调：把 useGlobalProps() 的结果落进来 */
export function setHostProps(props: unknown): void {
  if (!props || typeof props !== 'object') return;
  const p = props as Record<string, unknown>;

  const loc = p.__fpLocation;
  if (loc && typeof loc === 'object') location = loc as HostLocation;

  const base = p.__fpApiBase;
  const st = p.__fpShareToken;
  const pf = p.__fpPlatform;
  if (typeof st === 'string' && st) shareToken = st;

  // 回跳凭证：只认带 code 的对象，空壳（壳初始化时写的空值）不覆盖已有值
  const au = p.__fpAuth;
  if (au && typeof au === 'object' && typeof (au as HostAuth).code === 'string' && (au as HostAuth).code) {
    authCallback = au as HostAuth;
    // 通知订阅者。复制一份再遍历：回调里可能取消订阅，直接遍历原集合会在迭代中修改它
    for (const fn of [...authListeners]) {
      try {
        fn(authCallback);
      } catch {
        // 单个订阅者抛错不该影响其它订阅者与主流程
      }
    }
  }

  if (typeof pf === 'string' && pf) platform = pf;
  if (typeof base === 'string' && base) apiBase = base;
}

/** 最近一次三方回跳凭证；没有回过跳为 null */
export function getHostAuth(): HostAuth | null {
  return authCallback;
}

/** 消费掉回跳凭证：兑换过一次就清空，防止同一 code 被重复提交 */
export function takeHostAuth(): HostAuth | null {
  const got = authCallback;
  authCallback = null;
  return got;
}

/** 最近一次宿主下发的定位快照；没下发过为 null */
export function getHostLocation(): HostLocation | null {
  return location;
}

/**
 * 定位快照的指纹，用来判断「值真的变了」。
 * 直接拿对象当依赖不行：每次渲染都可能是新对象但内容一样，
 * 会让下游反复重跑（每次都打一遍逆地理，按次计费）。
 */
export function locationStamp(): string {
  if (!location) return '';
  const p = location as Record<string, unknown>;
  if (p.error) return `err:${p.error}`;
  return `${p.lng},${p.lat},${p.at ?? ''}`;
}

/** 后端地址；宿主没下发时为空串（web 预览走相对路径由 dev server 代理） */
export function hostApiBase(): string {
  return apiBase;
}

/** 分享页 token；不是分享页时为空串，调用方据此保持在正常首页 */
export function hostShareToken(): string {
  return shareToken;
}

/**
 * 端标识，用于埋点与 AI 度量的 platform 字段。
 *
 * 优先级：宿主显式下发 `__fpPlatform` → 有没有原生同步桥 `__fpStorage` → 当作 web。
 *
 * 为什么不用 UA：Lynx 不是浏览器，`navigator.userAgent` 在原生运行时里要么不存在、
 * 要么是各厂商自己拼的字符串，「只有 iOS 中断」这类问题根本切不开。
 * 用「有没有原生桥」判定的理由是：那个桥只有原生壳会注入（storage.ts:8），
 * web 预览一律没有 —— 它比 UA 稳定，也比 UA 诚实。
 */
export function hostPlatform(): string {
  if (platform) return platform;
  const g = globalThis as { __fpStorage?: unknown };
  return g.__fpStorage ? 'native' : 'web';
}