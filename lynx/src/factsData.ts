// 避坑数据的状态与来源标记（G4）。
//
// 为什么状态单独放一个文件、不放 facts.ts：拉取要用 api.ts，而 api.ts 里
// `<T>(path)` 的泛型箭头会被 rstest 当成 JSX，整条 import 链上的测试都跑不起来。
// 状态是纯的，拉取不是，分开才能两边都活得下去。
import bundled from '../../data/facts.json';
import type { TravelFact } from '../../shared/types/index.js';

/** 随包快照。仓库根 data/facts.json，server seed 也读它，但那是构建时的那一份 */
const bundledFacts = bundled as TravelFact[];

export type FactsSource = 'bundled' | 'server';

let current: TravelFact[] = bundledFacts;
let source: FactsSource = 'bundled';
/** 服务端返回时刻；兜底时留空，界面不得编一个「刚刚更新」 */
let fetchedAt = '';

export const facts = (): TravelFact[] => current;
export const factsSource = (): FactsSource => source;
export const factsFetchedAt = (): string => fetchedAt;

/**
 * 数据时点文案。兜底时必须说清是随包快照——不能让用户以为手里这份是刚核验的，
 * 那正是「未知票价不能写成免费」同一个道理。
 */
export function factsStamp(): string {
  return source === 'server' && fetchedAt ? `服务端 ${fetchedAt}` : '随包快照（离线兜底）';
}

/** 服务端拉回来的那份替换进去。空数组当作无效：不能把用户手里的兜底副本清空 */
export function adoptServerFacts(items: TravelFact[]): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  current = items;
  source = 'server';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  fetchedAt = `${hh}:${mm}`;
  return true;
}

/** 测试与排查用：回到随包快照 */
export function resetFacts(): void {
  current = bundledFacts;
  source = 'bundled';
  fetchedAt = '';
}
