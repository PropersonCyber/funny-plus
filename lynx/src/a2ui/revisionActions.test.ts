import { describe, expect, it } from '@rstest/core';

import { parseRevisionAction } from './revisionActions.js';

describe('预览动作白名单', () => {
  it('确认与取消都只认 previewId', () => {
    const c = parseRevisionAction({ name: 'confirm', context: { previewId: 'rev-1' } });
    const x = parseRevisionAction({ name: 'cancel', context: { previewId: 'rev-1' } });
    expect(c).toEqual({ kind: 'confirm', previewId: 'rev-1' });
    expect(x).toEqual({ kind: 'cancel', previewId: 'rev-1' });
  });

  it('载荷里夹带的业务字段一律丢弃，不进结果', () => {
    const parsed = parseRevisionAction({
      name: 'confirm',
      context: {
        previewId: 'rev-9',
        // 恶意或误带的字段：不得影响应用结果
        plan: { days: [] },
        impact: { minutes: 999, cost: -1 },
        reason: '换成别的措辞',
      },
    });
    expect(parsed).toEqual({ kind: 'confirm', previewId: 'rev-9' });
    expect(Object.keys(parsed!)).toEqual(['kind', 'previewId']);
  });

  it('未知动作名被忽略', () => {
    expect(parseRevisionAction({ name: 'applyAll', context: { previewId: 'rev-1' } })).toBeNull();
    expect(parseRevisionAction({ name: '', context: { previewId: 'rev-1' } })).toBeNull();
  });

  it('缺 previewId 或类型不对被忽略', () => {
    expect(parseRevisionAction({ name: 'confirm', context: {} })).toBeNull();
    expect(parseRevisionAction({ name: 'confirm', context: { previewId: 123 } })).toBeNull();
    expect(parseRevisionAction({ name: 'confirm', context: undefined })).toBeNull();
    expect(parseRevisionAction({ name: 'confirm' })).toBeNull();
  });

  it('空 payload 与畸形 payload 不抛异常', () => {
    expect(parseRevisionAction(undefined)).toBeNull();
    expect(parseRevisionAction(null)).toBeNull();
    expect(parseRevisionAction({})).toBeNull();
    expect(parseRevisionAction({ name: 'confirm', context: 'not-an-object' })).toBeNull();
  });
});