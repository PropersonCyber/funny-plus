import type { Demand, Plan, TripMemory } from '@/types'

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
 * 生成草稿正文。**没有任何记录时返回空串**，由页面去邀请补充。
 *
 * 为什么连「还没记：A、B」也不给：N8 的空态要求是「留空或邀请补充」，
 * 而一整份只有待补清单的草稿，在页面上是带着「用作回顾」按钮的 ——
 * 点一下就把一串地点名变成了公开攻略的概述。邀请补充该由页面自己做，
 * 不该伪装成一份可采纳的整理结果。
 *
 * 只在「至少有一条记录」时，末尾才附上待补清单：那时它确实是补充提示，
 * 而不是这份草稿的全部内容。
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

  // 一条记录都没有：整份草稿就只有一串地点名，那不是整理结果，是空态
  if (!blocks.length) return '';

  if (unrecorded.length) {
    blocks.push(`还没记：${unrecorded.join('、')}`);
  }

  return blocks.join('\n');
}

/**
 * 结束旅行时该不该生成草稿、生成哪一份。
 *
 * 抽成纯函数是因为这里每条规则都在防一件事，而每件事错了页面都不报错：
 * - 已经写过回顾 → 不生成（他要的是保存，不是被整理）
 * - 已经有一份没处理的草稿 → 不覆盖（会把他正在看的那份换掉）
 * - 用户已经否掉过，且之后什么都没改 → 不再生成（同一份内容再端一次是骚扰）
 * - 否掉之后又写了新记录 → 允许重新整理（新内容确实值得再整理一次）
 * - 整理出来是空的 → 不生成（空态交给页面邀请补充）
 */
export function draftFor(trip: TripLike, memory: TripMemory): string | null {
  if (memory.overview.trim()) return null;
  if (memory.draft) return null;
  // updatedAt 是「这份回忆最后一次被改」的时刻：任何一处记录/照片改动都会刷新它
  if (memory.draftDismissedAt && memory.updatedAt <= memory.draftDismissedAt) return null;
  const draft = buildMemoryDraft(trip, memory);
  return draft || null;
}
