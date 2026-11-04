// 一切业务计算都复用 shared/engine 的确定性引擎，这里只做适配，不复制规则
import { generatePlans, revisePlan } from '../../shared/engine/planner.js';
import { facts } from './facts.js';
import { places } from './places.js';
import { distanceKm, placeById, setPlaces } from '../../shared/engine/placeIndex.js';
import { splitByFreshness, trustLabel } from '../../shared/engine/facts.js';
import type { ChangeImpact, Demand, Place, Plan } from '../../shared/types/index.js';

// 引擎的索引需要在同步计算前就绪；原生壳没有接口可拉，先用本地副本顶上
try {
  setPlaces(places);
} catch (e) {
  console.error('[places] 初始化失败', e);
}

type BudgetLevel = Demand['budgetLevel'];

export type { ChangeImpact, Demand, Plan };

/** 接口返回的地点池覆盖随包副本：副本只是断网兜底，线上仍以库为准 */
export function applyPlaces(list: Place[]): void {
  if (list.length) setPlaces(list);
}
// 只做转发：视图层不该直接依赖 engine 路径，换生成方式时只动这一处
export { revisePlan };

/** 避坑条目：原生壳读本地副本（./facts.ts），H5 读 GET /api/facts。A2 规则：过期条目不展示 */
export function factsOf(city: string, today = new Date()): typeof facts {
  return splitByFreshness(
    facts.filter((f) => f.city === city),
    today
  ).fresh;
}

/**
 * A2 口径里「先不展示」和「告知还有几条」是一件事的两半。
 * 只过滤不计数，用户就分不清是这条城没数据还是被藏了。
 */
export function factsExpiredCount(city: string, today = new Date()): number {
  return splitByFreshness(
    facts.filter((f) => f.city === city),
    today
  ).expired.length;
}

export { distanceKm, placeById, facts, trustLabel };

export const DEFAULT_DEMAND: Demand = {
  destination: '成都',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: ['经典打卡'],
  transport: 'public',
  notes: '',
};

export function planFor(demand: Demand): Plan[] {
  return generatePlans(demand);
}


export const BUDGET_LABEL: Record<BudgetLevel, string> = {
  low: '500 元以内',
  mid: '500–1000 元',
  high: '1000–2000 元',
  flexible: '预算灵活',
};
