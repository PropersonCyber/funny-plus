import { describe, expect, it } from '@rstest/core';

import type { ChangeImpact } from '../data.js';
import { DEFAULT_DEMAND, planFor } from '../data.js';
import type { AffectedChange } from '../../../shared/types/index.js';
import type { RevisePreview } from '../../../shared/types/index.js';
import { fmtDelta, fmtMoney, revisionMessagesOf, type RevisionCardModel } from './revisionMessages.js';

const plan = planFor(DEFAULT_DEMAND)[0]!;

const affected: AffectedChange[] = [
  { kind: 'removed', title: '青羊宫', detail: '已移出这一天' },
  { kind: 'retimed', title: '宽窄巷子', detail: '14:00 → 15:30' },
];

const impact = (over: Partial<ChangeImpact> = {}): ChangeImpact => ({
  minutes: -70,
  cost: 0,
  recheck: ['门票是否还免'],
  note: '第二天去掉青羊宫',
  ...over,
});

const preview = (over: Partial<RevisePreview> = {}): RevisePreview => ({
  plan,
  impact: impact(),
  affected,
  reason: '第二天轻松点',
  by: 'model',
  ...over,
});

/** 从协议消息里取出卡片模型，避免用例依赖消息内部结构 */
/** 协议消息是联合类型，用例里只关心 createSurface 这一支 */
type CreateSurfaceOf = {
  createSurface?: { surfaceId: string; catalogId?: string; components?: { id: string }[] };
};

function modelOf(p: RevisePreview): RevisionCardModel | null {
  const msgs = revisionMessagesOf(p, 'rev-test', 'probe-surface', 'cat-1');
  const first = msgs[0] as CreateSurfaceOf;
  const comps = first?.createSurface?.components ?? [];
  const root = comps.find((c) => c.id === 'root');
  return (root as RevisionCardModel | undefined) ?? null;
}

describe('预览 → A2UI 消息转换', () => {
  it('时间与人均沿用旧卡片格式：0 显示没变，正值带 +，费用带 ¥', () => {
    expect(fmtDelta(0, ' 分钟')).toBe('没变');
    expect(fmtDelta(-70, ' 分钟')).toBe('-70 分钟');
    expect(fmtDelta(15, ' 分钟')).toBe('+15 分钟');
    expect(fmtMoney(0)).toBe('没变');
    // 与旧卡片逐字一致：负号在 ¥ 之后（现有实现的输出就是 ¥-30）
    expect(fmtMoney(-30)).toBe('¥-30');
    expect(fmtMoney(45)).toBe('+¥45');
  });
  it('产出一条 createSurface，catalogId 与 surfaceId 由调用方给', () => {
    const msgs = revisionMessagesOf(preview(), 'rev-1', 'surface-1', 'cat-1');
    expect(msgs).toHaveLength(1);
    const s = (msgs[0] as CreateSurfaceOf).createSurface!;
    expect(s.surfaceId).toBe('surface-1');
    // catalogId 缺了渲染器查不到组件，一律判「不支持」（探针踩过）
    expect(s.catalogId).toBe('cat-1');
    expect(s.components?.[0]?.id).toBe('root');
  });

  it('卡片带上原因、逐条影响、时间/人均、待确认与 previewId', () => {
    const m = modelOf(preview());
    expect(m).not.toBeNull();
    expect(m!.reason).toBe('第二天轻松点');
    expect(m!.affectedLines).toEqual(['青羊宫：已移出这一天', '宽窄巷子：14:00 → 15:30']);
    expect(m!.impactLine).toBe('时间-70 分钟 · 人均没变');
    expect(m!.recheckLine).toBe('要重新确认：门票是否还免');
    expect(m!.previewId).toBe('rev-test');
  });

  it('recheck 为空时不产出那一行', () => {
    const m = modelOf(preview({ impact: impact({ recheck: [] }) }));
    expect(m!.recheckLine).toBe('');
  });

  it('model 来源不显示兜底提示，engine 来源显示', () => {
    expect(modelOf(preview({ by: 'model' }))!.engineNote).toBe('');
    expect(modelOf(preview({ by: 'engine' }))!.engineNote).toBe('这次没连上模型，是按关键词识别的改动');
  });

  it('affected 为空时不产出明细行，但其余照常', () => {
    const m = modelOf(preview({ affected: [] }));
    expect(m!.affectedLines).toEqual([]);
    expect(m!.reason).toBe('第二天轻松点');
  });

  it('费用正负与时间正负都正确落进文案', () => {
    const m = modelOf(preview({ impact: impact({ minutes: 25, cost: 45, recheck: [] }) }));
    expect(m!.impactLine).toBe('时间+25 分钟 · 人均+¥45');
  });

  it('转换不读模型文本、不改原始数据', () => {
    const p = preview();
    const snapshot = JSON.stringify(p);
    revisionMessagesOf(p, 'rev-2', 's', 'c');
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});