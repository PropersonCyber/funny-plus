import type { ChangeImpact, Demand, Plan } from './data.js';

/**
 * 本机保存。踩过的坑：这个 app 现在跑在 iOS 的 WKWebView + @lynx-js/web-core 里，
 * 业务 JS 在 Worker 沙箱中执行，`window/document/localStorage` 都没有，所以原来那一版恒失败。
 *
 * 现在的做法分三层，按能用性从高到低试：
 *   1. 宿主注入的同步桥 `globalThis.__fpStorage`（原生壳将来要真持久化就实现这个，接口 getItem/setItem）
 *   2. IndexedDB —— Worker 里是有的，能跨重启
 *   3. localStorage —— 普通浏览器 / web 预览
 *   4. 纯内存 —— 只活一次会话，readLocal 仍能读到本次写的内容
 *
 * 同步读：启动时 hydrate() 把已知 key 读进内存，之后所有读都走内存，保持原来的同步接口。
 * 写入：先落内存（立刻可读），再异步刷到持久层；`writeLocal` 的返回值只表示「是否真能持久」，
 * 所以拿不到持久层时界面仍然老实显示「刷新会丢」。
 */
const KEYS = [
  'funny-plus.trips.v2',
  'funny-plus.trip.v1',
  'funny-plus.content.v1',
  'funny-plus.feedback.v1',
  'funny-plus.client-id.v1'
];
const DB_NAME = 'funny-plus';
const DB_STORE = 'kv';

export type Backend = 'native' | 'indexeddb' | 'localstorage' | 'memory';

const mem = new Map<string, string>();
let backend: Backend = 'memory';
let ready = false;

/* eslint-disable @typescript-eslint/no-explicit-any */
function nativeBridge(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  const g = globalThis as any;
  const b = g?.__fpStorage;
  return b && typeof b.getItem === 'function' && typeof b.setItem === 'function' ? b : null;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}

function openDb(): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      const g = globalThis as any;
      if (typeof g.indexedDB === 'undefined' || !g.indexedDB) return resolve(null);
      const req = g.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // 某些宿主既不 success 也不 error，别让首屏一直等
      setTimeout(() => resolve(null), 1500);
    } catch {
      resolve(null);
    }
  });
}

function idbGet(db: any, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbSet(db: any, key: string, value: string): void {
  try {
    db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, key);
  } catch {
    // 写失败就只留内存，界面按 backend 如实提示
  }
}

/** 启动时调一次：把持久层里已有的 key 读进内存，并决定 backend */
export async function hydrate(): Promise<Backend> {
  if (ready) return backend;
  const loaded = new Set<string>();

  const bridge = nativeBridge();
  if (bridge) {
    for (const k of KEYS) {
      const v = bridge.getItem(k);
      if (typeof v === 'string') {
        mem.set(k, v);
        loaded.add(k);
      }
    }
    backend = 'native';
  } else if (hasLocalStorage()) {
    for (const k of KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) {
          mem.set(k, v);
          loaded.add(k);
        }
      } catch {
        // 单个 key 读失败不影响其它 key
      }
    }
    backend = 'localstorage';
  } else {
    const db = await openDb();
    if (db) {
      for (const k of KEYS) {
        const v = await idbGet(db, k);
        if (v !== null) {
          mem.set(k, v);
          loaded.add(k);
        }
      }
      (globalThis as any).__fpDb = db;
      backend = 'indexeddb';
    } else {
      backend = 'memory';
    }
  }

  ready = true;

  // 早于 hydrate 写进内存的 key（比如反馈去重用的 clientId）要补刷一次，
  // 否则它永远只在内存里，重启就换新设备
  for (const [k, v] of mem) {
    if (!loaded.has(k)) persist(k, v);
  }

  return backend;
}

/** 真正的写入；backend 还是 memory 时直接返回 false */
function persist(key: string, value: string): boolean {
  const db = (globalThis as any).__fpDb;
  if (backend === 'native') {
    try {
      nativeBridge()?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  if (backend === 'indexeddb' && db) {
    idbSet(db, key, value);
    return true;
  }
  if (backend === 'localstorage') {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function readLocal(key: string): string | null {
  return mem.get(key) ?? null;
}

export function writeLocal(key: string, value: string): boolean {
  mem.set(key, value);
  return persist(key, value);
}

/** 一次局部修改的解释，落盘后「改过什么」才可回看，不是只活在当前会话 */
export type TripVersion = {
  at: string;
  note: string;
  impact?: ChangeImpact;
};

export type SavedTrip = {
  id: string;
  demand: Demand;
  plans: Plan[];
  /** 用户在方案对比里选中的那套；不存的话重开就退回第一套，等于白选 */
  planIndex: number;
  savedAt: string;
  versions: TripVersion[];
};

export type Store = {
  trips: SavedTrip[];
  activeId: string;
};

const KEY = 'funny-plus.trips.v2';
const LEGACY_KEY = 'funny-plus.trip.v1';

const isPlan = (p: unknown): p is Plan => {
  const v = p as Plan | null;
  return !!v && typeof v.id === 'string' && Array.isArray(v.days) && !!v.budget && Array.isArray(v.issues);
};

const isTrip = (t: unknown): t is SavedTrip => {
  const v = t as SavedTrip | null;
  return (
    !!v &&
    typeof v.id === 'string' &&
    !!v.demand &&
    typeof v.demand.destination === 'string' &&
    Array.isArray(v.plans) &&
    v.plans.length > 0 &&
    v.plans.every(isPlan)
  );
};

/** 旧版只存一条行程（demand + plans）；读到就转成一个 trip，不丢用户已经生成的方案 */
function migrateLegacy(): Store | null {
  const raw = readLocal(LEGACY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { demand?: Demand; plans?: Plan[]; savedAt?: string };
    if (!parsed?.demand?.destination || !Array.isArray(parsed.plans) || parsed.plans.length === 0) return null;
    if (!parsed.plans.every(isPlan)) return null;
    const trip: SavedTrip = {
      id: 'trip-legacy',
      demand: parsed.demand,
      plans: parsed.plans,
      planIndex: 0,
      savedAt: parsed.savedAt ?? new Date().toISOString(),
      // 旧版没存变更记录，不编造：老实留空
      versions: []
    };
    return { trips: [trip], activeId: trip.id };
  } catch {
    return null;
  }
}

export function loadStore(): Store | null {
  const raw = readLocal(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Store;
      const trips = (parsed?.trips ?? []).filter(isTrip).map((t) => ({
        ...t,
        planIndex: Math.min(Math.max(0, Number(t.planIndex) || 0), t.plans.length - 1),
        versions: Array.isArray(t.versions) ? t.versions : []
      }));
      if (trips.length) {
        const activeId = trips.some((t) => t.id === parsed.activeId) ? parsed.activeId : trips[0].id;
        return { trips, activeId };
      }
    } catch {
      // 存档坏了就退回旧版迁移 / 默认数据，不让首屏崩
    }
  }
  return migrateLegacy();
}

/** 写成功才返回 true；拿不到持久层时返回 false，界面据此如实提示 */
export function saveStore(store: Store): boolean {
  return writeLocal(KEY, JSON.stringify(store));
}

let seq = 0;
export function newTripId(): string {
  seq += 1;
  return `trip-${Date.now().toString(36)}-${seq}`;
}
