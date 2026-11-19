/**
 * 埋点：落本地缓冲 + console + 批量上报服务端（F10 评估）。
 *
 * 设计底线是「埋点不能拖累主流程」，所以：
 *   1. track() 是同步的，永不 await、永不抛错。网络请求全部 fire-and-forget。
 *   2. 失败只丢这一批，不影响后续；不重试、不阻塞。丢几条埋点远好过卡住一次点击。
 *   3. 缓冲满 / 定时 / 切后台三种时机各触发一次 flush，避免「一直不滚到阈值就一直不上报」。
 *
 * 事件名与 PRD 第八章对齐，参数只放能定位问题的字段，不放全量行程。
 */
import { deviceId } from './device.js';
import { hostApiBase, hostPlatform } from './hostBridge.js';

type Props = Record<string, string | number | boolean | undefined>;

type Entry = {
  event: string;
  props: Props;
  at: string;
  /** 打点时所属的验收旅程；见 setJourney */
  journey: string | null;
  /** 端标识；见 hostBridge.hostPlatform */
  platform: string;
};

/** 攒够这么多条就发一批。太小会让首屏多发请求，太大会让崩溃前的数据全丢 */
const BUFFER_MAX = 20;
/** 距上次上报超过这么久也发一批：长会话里用户可能一直不触发第二次操作 */
const FLUSH_INTERVAL_MS = 15000;

const buffer: Entry[] = [];
let inflight = false;
// 从模块加载时刻起算，不从 0 起算：0 会让「距上次上报 > 15s」在冷启动后的第一条事件上
// 立刻成立，于是每次冷启动都白发一个只有一条事件的请求
let lastFlush = Date.now();

/**
 * 会话标识：一次冷启动一个。
 *
 * 与 deviceId 分开：deviceId 是设备维度（本机存储，可能跨天），
 * sessionId 用来把「一次验收旅程」串起来。没有账号体系时，只有它能区分
 * 同一台设备上的第二次测试，靠时间戳猜会把并发测试搅在一起。
 */
const sessionId = `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function trackSessionId(): string {
  return sessionId;
}

/**
 * 本轮工作属于哪条验收旅程。
 *
 * 事件里只有 sessionId 是不够的：sessionId 只区分「冷启动了几次」，
 * 回答不了「任务 A 和任务 B 各自的漏斗」—— 同一次冷启动里可能既规划又改行程。
 * 所以 journey 由页面在进入时标注，随每条事件一起上报。
 */
let journey: string | null = null;

/** 页面进入时标注（plan / revise / share）；传 null 回到「日常使用」 */
export function setJourney(next: string | null): void {
  journey = next;
}

/** 当前旅程；AI 请求体里也要带，服务端度量按它分组 */
export function trackJourney(): string | null {
  return journey;
}

export function track(event: string, props: Props = {}): void {
  buffer.push({ event, props, at: new Date().toISOString(), journey, platform: hostPlatform() });
  // 溢出时丢最旧的：最近的上下文更能解释「用户最后做了什么」
  if (buffer.length > 100) buffer.shift();
  console.log('[track]', event, JSON.stringify(props));

  if (buffer.length >= BUFFER_MAX) flush();
  else if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) flush();
}

/**
 * 把缓冲发走。
 *
 * 全部同步取走再清空缓冲，而不是发完再清：请求期间新来的事件属于下一批，
 * 不能因为这次请求成功就被当成已上报。
 */
export function flush(): void {
  if (inflight || !buffer.length) return;

  const batch = buffer.splice(0, buffer.length);
  const body = {
    events: batch.map((e) => ({ ...e, sessionId, clientId: deviceId() }))
  };
  inflight = true;
  lastFlush = Date.now();

  try {
    void fetch(`${hostApiBase()}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .catch(() => {
        // 网络失败就丢掉这一批。不塞回缓冲：塞回去会在断网时无限堆积并反复重发
      })
      .finally(() => {
        inflight = false;
      });
  } catch {
    // fetch 本身不存在或同步抛错：同样只丢这一批
    inflight = false;
  }
}

/**
 * 切后台 / 卸载前补一次。
 *
 * 没有这一步，用户「做完最后一步就切走」时，最后几条事件永远发不出去 ——
 * 而那几条恰恰是判断旅程是否完成的关键。
 */
export function flushOnHide(): void {
  const g = globalThis as { addEventListener?: (t: string, cb: () => void) => void };
  g.addEventListener?.('pagehide', () => flush());
  g.addEventListener?.('visibilitychange', () => flush());
}

/** 调试/验收用：不看 DevTool 也能取出最近的事件 */
export function recent(): Entry[] {
  return buffer.slice();
}