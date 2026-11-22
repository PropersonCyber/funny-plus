import type { ChangeImpact, Demand, GuideDraft, GuideSection, GuideSectionItem, PhotoRef, PlaceNote, Plan, TripMemory } from './data.js';

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
  'funny-plus.client-id.v1',
  // 与 chatSession.CHAT_STORAGE_KEY 同一串：漏了的话重启后对话读不回来
  'funny-plus.chat.v1',
  // 旅行回忆：与行程分开存，改行程不能把已写的回忆冲掉
  'funny-plus.memory.v1',
  // 攻略草稿：同样独立一份，回忆改了草稿不该跟着变
  'funny-plus.guides.v1'
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
  /**
   * 用户主动结束这次旅行的时刻。undefined = 还在进行中。
   *
   * 用可选字段而不是状态枚举：旧存档读进来没有这个字段，天然就是「进行中」，
   * 不需要写迁移。也给「结束后又重开」留了余地（清空即可）。
   */
  endedAt?: string;
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

/**
 * id 带上设备前缀。
 *
 * 原来只有「毫秒时间戳 + 进程内自增」：两台设备在同一毫秒各建一条行程，就会得到同一个 id。
 * 而这些 id 会被推到云端当主键（`PUT /api/trips/:id`），撞了就变成互相覆盖别人的行程。
 * 设备标识本来就在本机存着，拼上它一行就够，不需要引入 uuid 库：
 * 换设备后 id 仍可能撞的是「同一台设备重启后同一毫秒」——那个概率可以忽略，
 * 且 time+seq 已经能区分。shortcut: 不做全局唯一保证，真需要时换 uuid v7。
 */
const idPrefix = (): string => {
  // 键名与 api.ts 的 CLIENT_KEY 同一个；不 import 它是因为 api.ts 反过来依赖本模块，
  // 会形成循环引用
  const dev = readLocal('funny-plus.client-id.v1') ?? '';
  // 设备 id 形如 s-xxxx-yyyy，取后半段的随机部分就够了，不必把整个串塞进每个 id
  return dev ? `${dev.slice(-6)}-` : '';
};

export function newTripId(): string {
  seq += 1;
  return `trip-${idPrefix()}${Date.now().toString(36)}-${seq}`;
}

/* ---------------- 旅行回忆：与行程分开存 ---------------- */

const MEMORY_KEY = 'funny-plus.memory.v1';

export type MemoryBook = Record<string, TripMemory>;

const isPhoto = (p: unknown): p is PhotoRef => {
  const v = p as PhotoRef | null;
  return !!v && typeof v.id === 'string' && typeof v.value === 'string' && typeof v.kind === 'string';
};

/**
 * 读回忆。
 *
 * 逐层校验而不是整份丢弃：用户写的文字最值钱，某条记录格式坏了只该丢那一条，
 * 不该把整本回忆清空 —— 那等于用户写过的全没了。
 */
export function loadMemory(): MemoryBook {
  const raw = readLocal(MEMORY_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: MemoryBook = {};
    for (const [tripId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const m = value as TripMemory | null;
      if (!m || typeof m !== 'object') continue;
      const places: Record<string, PlaceNote> = {};
      for (const [ref, note] of Object.entries(m.places ?? {})) {
        const n = note as PlaceNote | null;
        if (!n || typeof n.text !== 'string') continue;
        places[ref] = {
          planRef: typeof n.planRef === 'string' ? n.planRef : ref,
          dayIndex: Number(n.dayIndex) || 0,
          placeId: typeof n.placeId === 'string' ? n.placeId : '',
          placeTitle: typeof n.placeTitle === 'string' ? n.placeTitle : '',
          // 只认三态，其它一律 unknown：宁可不认定，也不能把没去过的记成去过
          visited: n.visited === 'yes' || n.visited === 'no' ? n.visited : 'unknown',
          text: n.text,
          photos: Array.isArray(n.photos) ? n.photos.filter(isPhoto) : [],
          updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : new Date().toISOString()
        };
      }
      out[tripId] = {
        tripId,
        overview: typeof m.overview === 'string' ? m.overview : '',
        photos: Array.isArray(m.photos) ? m.photos.filter(isPhoto) : [],
        places,
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : new Date().toISOString()
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** 写成功才返回 true，与 saveStore 同一口径 */
export function saveMemory(book: MemoryBook): boolean {
  return writeLocal(MEMORY_KEY, JSON.stringify(book));
}

let photoSeq = 0;
export function newPhotoId(): string {
  photoSeq += 1;
  return `ph-${idPrefix()}${Date.now().toString(36)}-${photoSeq}`;
}

/* ---------------- 攻略草稿：独立一份，不与回忆联动 ---------------- */

const GUIDES_KEY = 'funny-plus.guides.v1';

export type GuideBook = Record<string, GuideDraft>;

/**
 * 读攻略草稿。
 *
 * 与回忆同一套思路：逐条校验、坏的只丢那一条。showCost 缺失一律按 false 处理 ——
 * 这是隐私开关，读档时宁可当成「不公开」，也不能因为字段缺失就默认公开。
 */
export function loadGuides(): GuideBook {
  const raw = readLocal(GUIDES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: GuideBook = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const g = value as GuideDraft | null;
      if (!g || typeof g !== 'object' || typeof g.tripId !== 'string') continue;
      const sections: GuideSection[] = [];
      for (const s of Array.isArray(g.sections) ? g.sections : []) {
        if (!s || typeof s !== 'object') continue;
        const items: GuideSectionItem[] = [];
        for (const it of Array.isArray(s.items) ? s.items : []) {
          if (!it || typeof it.planRef !== 'string') continue;
          items.push({
            planRef: it.planRef,
            placeTitle: typeof it.placeTitle === 'string' ? it.placeTitle : '',
            text: typeof it.text === 'string' ? it.text : '',
            visited: it.visited === 'yes' || it.visited === 'no' ? it.visited : 'unknown',
            photos: Array.isArray(it.photos) ? it.photos.filter(isPhoto) : [],
          });
        }
        if (items.length) sections.push({ dayIndex: Number(s.dayIndex) || 1, items });
      }
      out[id] = {
        // 草稿自己的 id 必须原样恢复。这里曾经用 book 的键（tripId）当 id，
        // 于是重启后 draft.id 从 gd-xxx 变成 tripId：推送换了个云端 id，
        // 云端多一份草稿，而旧分享链接再也撤不回来（撤回要按 draft.id 找行）。
        // 老存档里 id 缺失才退回用键——那时确实无从得知原 id。
        id: typeof g.id === 'string' && g.id ? g.id : id,
        tripId: g.tripId,
        title: typeof g.title === 'string' ? g.title : '',
        summary: typeof g.summary === 'string' ? g.summary : '',
        photos: Array.isArray(g.photos) ? g.photos.filter(isPhoto) : [],
        // 隐私开关：只有显式 true 才算公开
        showCost: g.showCost === true,
        // 缺失时按「不勾」恢复：宁可让用户重新点，也不要默认把没确认的内容算成公开
        picked: (() => {
          const out: Record<string, boolean> = {};
          const src = g.picked && typeof g.picked === 'object' ? (g.picked as Record<string, unknown>) : {};
          for (const [k, v] of Object.entries(src)) if (v === true) out[k] = true;
          return out;
        })(),
        sections,
        createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
        updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : new Date().toISOString(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveGuides(book: GuideBook): boolean {
  return writeLocal(GUIDES_KEY, JSON.stringify(book));
}

let guideSeq = 0;
export function newGuideId(): string {
  guideSeq += 1;
  return `gd-${idPrefix()}${Date.now().toString(36)}-${guideSeq}`;
}
