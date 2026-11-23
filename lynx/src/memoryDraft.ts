import type { Demand, Plan, TripMemory } from './data.js';

/**
 * 结束旅行时整理出的回忆草稿（N8）。
 *
 * 硬约束：只重排用户自己写下的东西，一个字的感受都不替用户生成。
 * 回忆是「实际发生了什么」，一旦这里编了一句「下午很惬意」，用户自己在攻略里
 * 分辨不出哪些是他写的、哪些是机器写的，亲历与计划的边界就废了。
 *
 * 所以三个桶严格按 visited 三态切：
 * - yes       → 写成亲历
 * - no        → 明写没去（他明确否认过，不能悄悄从草稿里消失）
 * - unknown   → 有内容就带上并标「未确认到访」，没内容只留名字在末尾待补清单
 */

type TripLike = { demand: Demand; plans: Plan[]; planIndex: number };

const LABEL: Record<'yes' | 'no', string> = { yes: '去了', no: '没去' };

/** 一条地点记录有没有「用户写过的东西」；没有就不该为它生成句子 */
function hasRecord(note: { visited?: string; text?: string; photos?: unknown[] } | undefined): boolean {
  if (!note) return false;
  if (note.visited === 'yes' || note.visited === 'no') return true;
  if ((note.text ?? '').trim().length > 0) return true;
  return (note.photos ?? []).length > 0;
}

/**
 * 生成草稿正文。没有可整理的内容时返回空串，由页面去邀请补充 ——
 * 返回一句「这趟旅行真棒」是最省事也最坏的做法。
 */
export function buildMemoryDraft(trip: TripLike, memory: TripMemory): string {
  const plan = trip.plans[Math.min(Math.max(0, trip.planIndex), trip.plans.length - 1)] ?? trip.plans[0];
  const days = plan?.days ?? [];
  if (!days.length) return '';

  const blocks: string[] = [];
  const unrecorded: string[] = [];

  for (const day of days) {
    // 餐食条目没有 placeId，问用户「午餐去没去」是废话（与回忆页同一条过滤）
    const items = day.items.filter((it) => it.kind !== 'meal' && !!it.placeId);
    const lines: string[] = [];

    for (const it of items) {
      const note = memory.places[it.id];
      if (!hasRecord(note)) {
        unrecorded.push(it.title);
        continue;
      }
      const text = (note?.text ?? '').trim();
      const label =
        note?.visited === 'yes' || note?.visited === 'no'
          ? LABEL[note.visited]
          : '未确认到访';
      lines.push(`· ${it.title}（${label}）${text ? `：${text}` : ''}`);
    }

    if (lines.length) blocks.push(`Day ${day.index}\n${lines.join('\n')}`);
  }

  if (unrecorded.length) {
    blocks.push(`还没记：${unrecorded.join('、')}`);
  }

  return blocks.join('\n');
}
