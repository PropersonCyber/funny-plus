import { hostApiBase } from './hostBridge.js';
import { trackJourney, trackSessionId } from './track.js';
import { authToken } from './api.js';
import { readToolResult } from './chatPayload.js';
import type { ChatPayload } from './chatPayload.js';
import type { Demand, Plan, RevisePreview, TripContext } from '../../shared/types/index.js';

/**
 * AI 对话客户端（流式优先，非流式兜底）。
 *
 * 单独成文件而不是塞进 api.ts：api.ts 的 request() 是「8 秒超时 + 一定 res.json()」，
 * 对话必然超过 8 秒、响应体也不是 JSON。混在一个函数里，早晚有人为了对话去调大
 * TIMEOUT_MS，把别的接口的失败检测一起拖长。
 *
 * 流式能力靠运行时探测而非编译期判断：Lynx 是自研 JS 运行时、不是浏览器，
 * getReader 到底有没有要跑起来才知道。探测不到就整体走非流式——
 * 少打字机效果，但功能不降级。
 */

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

/** 与服务端 Demand 同构的槽位，模型逐轮往里补，客户端负责往返携带 */
export type ChatSlots = {
  destination?: string;
  dayCount?: number;
  party?: number;
  budgetLevel?: 'low' | 'mid' | 'high' | 'flexible';
  preferences?: string[];
  transport?: 'public' | 'car' | 'charter' | 'compare';
  notes?: string;
};

export type ChatHandlers = {
  /** 每段文本增量调一次；非流式时只调一次、带全文 */
  onDelta: (text: string) => void;
  /** 模型正在调用哪个工具，用来显示「正在查询地点…」这类中间态 */
  onTool?: (name: string) => void;
  /**
   * 方案生成完给整份结果。
   * 收 Plan 而不是摘要：工作台直接渲染它，前端不再自己拼一份展示数据 ——
   * 拼两份的结果就是「对话里说的」和「行程页排的」迟早对不上。
   */
  onPlans?: (plans: Plan[], demand: Demand) => void;
  /** 咕噜提出了一次行程修改，等用户确认；确认前不落库 */
  onRevise?: (preview: RevisePreview) => void;
};

export type ChatResult = { slots: ChatSlots; streamed: boolean };

/** 修改接口的结果：degraded 表示这次没拿到服务端判断，调用方走本地兜底 */
export type ReviseResult =
  | { supported: true; preview: RevisePreview }
  | { supported: false; reason: string }
  | { degraded: true };

/** 对话是长任务，不套 api.ts 的 8 秒；90 秒兜底防止请求永远挂着 */
const CHAT_TIMEOUT_MS = 90000;

const base = (): string => hostApiBase();

function headers(): Record<string, string> {
  const token = authToken();
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

type Pending = { res: Response; done: () => void };

/**
 * 发请求并挂超时。
 *
 * 定时器只能由调用方在「读完之后」清掉：AbortController 管的是整个请求，
 * 包括读响应体。在这里 finally 里清，等于把流式长连接当短请求，读到一半就被 abort。
 */
async function postAi(path: 'chat' | 'revise', body: Record<string, unknown>): Promise<Pending> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), CHAT_TIMEOUT_MS) : null;
  const done = () => {
    if (timer) clearTimeout(timer);
  };
  try {
    const res = await fetch(`${base()}/api/ai/${path}`, {
      method: 'POST',
      headers: headers(),
      // sessionId 与 journey 由这里统一注入，不让每个调用点自己拼：
      // 漏一个就少一条可归因的度量，而漏了不会报错，只会让漏斗莫名其妙缺一截
      body: JSON.stringify({ ...body, sessionId: trackSessionId(), journey: trackJourney() }),
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    return { res, done };
  } catch (err) {
    done();
    throw err;
  }
}

/**
 * 运行时能不能读流。
 *
 * 四个能力缺一不可：没有 ReadableStream 就没有流对象，没有 TextDecoder 就没法把
 * 字节还原成中文（中文是多字节，按字节拼字符串必然乱码）。
 * 用 try 包住是因为某些运行时访问这些全局会抛错而不是返回 undefined。
 */
export function canStream(): boolean {
  try {
    return (
      typeof ReadableStream !== 'undefined' &&
      typeof TextDecoder !== 'undefined' &&
      typeof Response !== 'undefined' &&
      typeof new Response(new ReadableStream()).body?.getReader === 'function'
    );
  } catch {
    return false;
  }
}

/** 兜底通道：一次拿全文，方案和修改预览都要交出去 */
async function chatNonStream(
  messages: ChatMessage[],
  slots: ChatSlots,
  handlers: ChatHandlers,
  trip?: TripContext
): Promise<ChatResult> {
  const { res, done } = await postAi('chat', { messages, slots, trip, stream: false });
  try {
    const body = (await res.json().catch(() => null)) as ChatPayload | null;
    if (!res.ok || !body) throw new Error(body?.error || `请求失败（${res.status}）`);

    if (body.text) handlers.onDelta(body.text);
    readToolResult('generatePlans', body.plans, handlers);
    readToolResult('proposeRevise', body.revise, handlers);
    return { slots: body.slots ?? slots, streamed: false };
  } finally {
    done();
  }
}

/**
 * 问一轮，返回更新后的槽位；对话历史与槽位都由调用方持有。
 *
 * trip 是「工作台上正在看的那份行程」：带上它，咕噜才是在改用户眼前这份；
 * 不带它就变成从零规划，用户会看到咕噜答非所问。
 */
export async function chat(
  messages: ChatMessage[],
  slots: ChatSlots,
  handlers: ChatHandlers,
  trip?: TripContext
): Promise<ChatResult> {
  if (!canStream()) return chatNonStream(messages, slots, handlers, trip);

  const { res, done } = await postAi('chat', { messages, slots, trip, stream: true });
  if (!res.ok) {
    // 未配置 / 参数错这类问题降级也没用，直接抛给界面显示
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    done();
    throw new Error(body?.error || `请求失败（${res.status}）`);
  }

  const reader = res.body?.getReader();
  // 拿到了响应头但 body 读不了：运行时只支持到 Response 这一层，
  // 退回非流式重来一次，比让用户盯着空白强
  if (!reader) {
    done();
    return chatNonStream(messages, slots, handlers, trip);
  }

  const decoder = new TextDecoder();
  let buf = '';
  let received = false;
  let next: ChatSlots = slots;

  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      received = true;
      // stream:true —— 一个中文字符的字节可能跨两个 chunk，不这样解会出乱码
      buf += decoder.decode(value, { stream: true });

      let sep = buf.indexOf('\n\n');
      while (sep >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        let event = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }

        if (data) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            // 单条坏掉不该打断整轮：已经吐给用户的内容仍然有效，丢掉这条继续读
            sep = buf.indexOf('\n\n');
            continue;
          }

          if (event === 'delta' && typeof parsed.text === 'string') {
            handlers.onDelta(parsed.text);
          } else if (event === 'tool' && typeof parsed.name === 'string') {
            handlers.onTool?.(parsed.name);
          } else if (event === 'tool_result' && typeof parsed.name === 'string') {
            readToolResult(parsed.name, parsed.output, handlers);
          } else if (event === 'done' && parsed.slots) {
            next = parsed.slots as ChatSlots;
          } else if (event === 'error') {
            throw new Error(typeof parsed.message === 'string' ? parsed.message : '模型返回出错');
          }
        }
        sep = buf.indexOf('\n\n');
      }
    }
  } finally {
    done();
  }

  // 探测说能读流、实际一条事件都没来：这条路在这个运行时上不可用，走兜底
  if (!received) return chatNonStream(messages, slots, handlers, trip);
  return { slots: next, streamed: true };
}

/**
 * 请服务端解析一次修改，拿回「待确认」的预览。
 *
 * 服务端已经把「模型做不到」和「模型挂了」分开了：
 * 前者 supported:false + 人能读懂的原因，后者走本地兜底并标 by='engine'。
 * 这里只额外处理「请求本身失败」（未配置 / 网络不通），交给调用方决定怎么降级。
 */
export async function revise(
  trip: TripContext,
  instruction: string,
  currentDay: number
): Promise<ReviseResult> {
  let res: Response;
  let done = () => {};
  try {
    const pending = await postAi('revise', { trip, instruction, currentDay });
    res = pending.res;
    done = pending.done;
  } catch {
    return { degraded: true };
  }
  try {
    const body = (await res.json().catch(() => null)) as
      | { supported?: boolean; preview?: RevisePreview; reason?: string; error?: string }
      | null;
    if (!res.ok || !body) return { degraded: true };
    if (body.supported && body.preview) return { supported: true, preview: body.preview };
    return { supported: false, reason: body.reason ?? body.error ?? '这句话没识别出可执行的修改' };
  } finally {
    done();
  }
}

/** 启动时问一次，决定助手入口显不显示 —— 和 /api/auth/status 同一套用法 */
export async function aiStatus(): Promise<{ enabled: boolean }> {
  try {
    const res = await fetch(`${base()}/api/ai/status`);
    if (!res.ok) return { enabled: false };
    return (await res.json()) as { enabled: boolean };
  } catch {
    return { enabled: false };
  }
}
