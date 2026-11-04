import type { Plan, Place } from '@/types';

/**
 * 从方案里提取「真正会用到的相邻路段」。
 *
 * 单独一个纯模块（不 import api / 不碰运行时）有两个原因：
 *   1. 取数层要在发请求前先知道该取哪些段，这个判断必须是纯的；
 *   2. 它值得被测试钉住——段数算错要么浪费配额，要么漏掉的段静默退回估算。
 */
export function legsOf(plans: Plan[], byId: Map<string, Place>): [Place, Place][] {
  const seen = new Set<string>();
  const out: [Place, Place][] = [];
  for (const plan of plans) {
    for (const day of plan.days) {
      const stops = day.items
        .filter((i) => i.kind === 'place' && i.placeId)
        .map((i) => byId.get(i.placeId!));
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (!a || !b) continue;
        const key = `${a.id}>${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([a, b]);
      }
    }
  }
  return out;
}
