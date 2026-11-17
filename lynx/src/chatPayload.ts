import type { Demand, Plan, RevisePreview } from '../../shared/types/index.js';

/** 非流式响应体。流式的 tool_result 和它是同一份结构，解析必须走同一个函数 */
export type ChatPayload = {
  text?: string;
  slots?: unknown;
  plans?: { ok?: boolean; plans?: Plan[]; demand?: Demand };
  revise?: { ok?: boolean; preview?: RevisePreview };
  error?: string;
};

type ToolHandlers = {
  onPlans?: (plans: Plan[], demand: Demand) => void;
  onRevise?: (preview: RevisePreview) => void;
};

/**
 * 把一次工具结果交给界面。
 *
 * 流式按事件调，非流式把同一份 output 再喂进来。两处各写一遍的话，
 * Lynx 读不了流时就会漏掉修改预览，对话里永远没有「确认应用」。
 */
export function readToolResult(name: string, output: unknown, handlers: ToolHandlers): void {
  if (name === 'generatePlans') {
    const out = output as ChatPayload['plans'];
    // 没带 demand 就拼不出可用的行程（工作台还要拿它算预算/校验），宁可不给也不给半份
    if (out?.ok && out.plans?.length && out.demand) handlers.onPlans?.(out.plans, out.demand);
    return;
  }
  if (name === 'proposeRevise') {
    const out = output as ChatPayload['revise'];
    if (out?.ok && out.preview) handlers.onRevise?.(out.preview);
  }
}
