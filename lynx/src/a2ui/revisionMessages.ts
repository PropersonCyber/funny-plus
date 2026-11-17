import type { ServerToClientMessage } from '@lynx-js/genui/a2ui';

import type { RevisePreview } from '../../../shared/types/index.js';

/**
 * 把引擎给的 RevisePreview 转成 A2UI v1.0 消息。
 *
 * 这一层刻意做成纯函数：不做网络、不读模型文本、不改入参。
 * 原始 RevisePreview 才是业务依据，消息只是展示产物（spec FR-1）。
 * 数字一律由引擎给，这里只拼格式，绝不补算。
 */

/** 卡片上要显示的几行文案，全部在这里定死，组件只负责摆 */
export type RevisionCardModel = {
  /** 协议组件名，catalog 里注册的名字 */
  component: 'TripRevisionCard';
  id: 'root';
  previewId: string;
  reason: string;
  /** 每条受影响安排的「标题：细节」 */
  affectedLines: string[];
  /** 时间与人均费用，格式与旧卡片一致 */
  impactLine: string;
  /** 为空表示这一版没有要重新确认的东西 */
  recheckLine: string;
  /** 为空表示这版是模型给的，不显示兜底提示 */
  engineNote: string;
};

/**
 * 变更影响不带正负号，加号和单位在这里拼 —— 与旧卡片同一套规则，
 * 两边格式必须一模一样，否则用户切到 A2UI 卡片会以为数字变了。
 */
export function fmtDelta(n: number, unit: string): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

export function fmtMoney(n: number): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}¥${n}`;
}

export function revisionCardOf(preview: RevisePreview, previewId: string): RevisionCardModel {
  const { impact, affected, reason, by } = preview;
  return {
    component: 'TripRevisionCard',
    id: 'root',
    previewId,
    reason,
    affectedLines: affected.map((a) => `${a.title}：${a.detail}`),
    impactLine: `时间${fmtDelta(impact.minutes, ' 分钟')} · 人均${fmtMoney(impact.cost)}`,
    // 空数组不产出这一行，与旧卡片的「有才显示」一致
    recheckLine: impact.recheck.length ? `要重新确认：${impact.recheck.join('；')}` : '',
    engineNote: by === 'engine' ? '这次没连上模型，是按关键词识别的改动' : '',
  };
}

/**
 * 一份预览 → 一条 createSurface。
 *
 * catalogId 必须显式给出：渲染器按 surface.catalogId 查组件表，缺省就是查不到，
 * 所有组件一律判「不支持」然后走降级 —— 探针第一次跑就是这么挂的。
 */
export function revisionMessagesOf(
  preview: RevisePreview,
  previewId: string,
  surfaceId: string,
  catalogId: string
): ServerToClientMessage[] {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId,
        catalogId,
        components: [revisionCardOf(preview, previewId)],
      },
    },
  ];
}