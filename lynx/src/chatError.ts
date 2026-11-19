/**
 * 对话失败的对外文案。
 *
 * 服务端返回的错误本来就是中文（`ServerError` 那套），可以直接给用户看；
 * 但 fetch 被 abort、断网、运行时异常抛出来的是英文原文（`AbortError` /
 * `Failed to fetch` / `Load failed`），直接渲染等于把调试信息当产品文案。
 *
 * 所以判据是「含不含中文」而不是「哪一类错误」：新增的错误源不需要来这里登记，
 * 只有明显是运行时错误的形状才翻译。
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  if (/abort/i.test(raw)) return '这条回复中断了，可以重新发送';
  if (/network|fetch|load failed|timeout|ECONN|ENOTFOUND/i.test(raw)) {
    return '网络不通，检查一下网络再试';
  }
  return '咕噜这边出了点问题，稍后再试';
}
