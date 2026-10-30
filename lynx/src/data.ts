// 一切业务计算都复用 shared/engine 的确定性引擎，这里只做适配，不复制规则
import { generatePlans } from '../../shared/engine/planner.js';
import { facts } from './facts.js';
import { places } from './places.js';
import { placeById, placesOf, setPlaces } from '../../shared/engine/placeIndex.js';
import type { Demand, Plan, TransportMode } from '../../shared/types/index.js';

// 引擎的索引需要在同步计算前就绪；原生壳没有接口可拉，先用本地副本顶上
try {
  setPlaces(places);
} catch (e) {
  console.error('[places] 初始化失败', e);
}

type BudgetLevel = Demand['budgetLevel'];

export type { Demand, Plan };

/** 避坑条目：原生壳读本地副本（./facts.ts），H5 读 GET /api/facts。A2 规则：过期条目不展示 */
export function factsOf(city: string, today = new Date()): typeof facts {
  return facts.filter((f) => {
    if (f.city !== city) return false;
    if (!f.validUntil) return true;
    return new Date(f.validUntil) >= today;
  });
}

export { placeById, facts };

export type CityOption = {
  id: string;
  tag: string;
  image: string;
};

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

export function placeCount(city: string): number {
  return placesOf(city).length;
}

export const BUDGET_LABEL: Record<BudgetLevel, string> = {
  low: '500 元以内',
  mid: '500–1000 元',
  high: '1000–2000 元',
  flexible: '预算灵活',
};

export const TRANSPORT_LABEL: Record<TransportMode, string> = {
  public: '公共交通',
  car: '自驾',
  charter: '包车',
  compare: '待比较',
};
