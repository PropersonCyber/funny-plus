import { describe, expect, it } from '@rstest/core';

/**
 * 对话失败文案（X5）。
 *
 * 原来直接把 `err.message` 塞进气泡，fetch 被 abort 或断网时用户看到的是
 * `AbortError` / `Failed to fetch` 这种英文原文。这类回归不会让测试变红，
 * 只会让人在真机上看见一句看不懂的话，所以判据要钉住。
 */
import { errorText } from './chatError.js';

describe('对话失败的对外文案', () => {
  it('服务端中文错误原样透出，不套一层「出错了」', () => {
    expect(errorText(new Error('AI 服务未配置'))).toBe('AI 服务未配置');
  });

  it('abort 给「重新发送」口径，与气泡上的按钮对应', () => {
    expect(errorText(new Error('AbortError: signal is aborted'))).toContain('重新发送');
  });

  it('断网给网络口径，不吐英文原文', () => {
    const said = errorText(new Error('Failed to fetch'));
    expect(said).not.toMatch(/fetch/i);
    expect(said).toContain('网络');
  });

  it('未知形状兜一句能读的话，不返回空串', () => {
    expect(errorText(undefined).length).toBeGreaterThan(0);
    expect(errorText(new Error(''))).toBe('咕噜这边出了点问题，稍后再试');
  });
});
