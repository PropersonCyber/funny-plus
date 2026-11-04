/**
 * 埋点：先落本地缓冲 + console，等有上报通道只改 flush 一处。
 * 事件名与 PRD 第八章对齐，参数只放能定位问题的字段，不放全量行程。
 */
type Props = Record<string, string | number | boolean | undefined>;

const BUFFER_MAX = 100;
const buffer: { event: string; props: Props; at: string }[] = [];

export function track(event: string, props: Props = {}): void {
  const entry = { event, props, at: new Date().toISOString() };
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  console.log('[track]', event, JSON.stringify(props));
}

/** 调试/验收用：不看 DevTool 也能取出最近的事件 */
