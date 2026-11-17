import { describe, expect, it } from '@rstest/core';

import { readToolResult } from './chatPayload.js';

describe('对话工具结果', () => {
  it('方案必须带 demand 才交给工作台', () => {
    let plans = 0;
    const handlers = { onPlans: () => { plans += 1; } };
    readToolResult('generatePlans', { ok: true, plans: [{ id: 'p1' }] }, handlers);
    expect(plans).toBe(0);

    readToolResult(
      'generatePlans',
      { ok: true, plans: [{ id: 'p1' }], demand: { destination: '成都' } },
      handlers
    );
    expect(plans).toBe(1);
  });

  it('修改预览只有确认卡数据齐了才出现', () => {
    let revises = 0;
    const handlers = { onRevise: () => { revises += 1; } };
    readToolResult('proposeRevise', { ok: false, error: '没听清要改哪一天' }, handlers);
    expect(revises).toBe(0);

    readToolResult('proposeRevise', { ok: true, preview: { reason: '少排一个' } }, handlers);
    expect(revises).toBe(1);
  });
});
