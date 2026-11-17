/**
 * 预览卡片的动作白名单。
 *
 * 为什么单独一层：A2UI 的 action 载荷来自渲染树，属于「外部输入」。
 * 业务层只该拿到「谁想干什么」，不该拿到任何计划或金额 —— 真正要应用的数据
 * 永远是客户端按 previewId 找回的那份原始 RevisePreview（spec FR-2）。
 * 所以这里对载荷做收敛：只留 kind 与 previewId，其余字段一律不往下传。
 */

export type RevisionAction =
  | { kind: 'confirm'; previewId: string }
  | { kind: 'cancel'; previewId: string };

/** A2UI 的 UserActionPayload 只用到 name 与 context，其余字段不参与判断 */
type RawAction = {
  name?: unknown;
  context?: unknown;
} | null | undefined;

const ALLOWED: Record<string, RevisionAction['kind']> = {
  confirm: 'confirm',
  cancel: 'cancel',
};

/**
 * 解析成功返回收敛后的动作；任何不认识、缺字段、类型不对的情况一律返回 null，
 * 由调用方忽略并记录诊断信息（不抛异常：渲染树不该因为一个脏载荷把整页搞崩）。
 */
export function parseRevisionAction(raw: RawAction): RevisionAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name;
  if (typeof name !== 'string') return null;
  const kind = ALLOWED[name];
  if (!kind) return null;

  const ctx = raw.context;
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
  const previewId = (ctx as Record<string, unknown>).previewId;
  if (typeof previewId !== 'string' || !previewId) return null;

  // 只挑这两个字段，载荷里别的什么 plan / impact / reason 都不带出去
  return { kind, previewId };
}