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

/** App 根组件调：把 useGlobalProps() 的结果落进来 */
export function setHostProps(props: unknown): void {
  if (!props || typeof props !== 'object') return;
  const p = props as Record<string, unknown>;

  const loc = p.__fpLocation;
  if (loc && typeof loc === 'object') location = loc as HostLocation;

  const base = p.__fpApiBase;
  if (typeof base === 'string' && base) apiBase = base;
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
