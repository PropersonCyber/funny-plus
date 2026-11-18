// 避坑数据：优先服务端，随包 JSON 只作离线兜底（G4）。
//
// 为什么不能只读随包副本：服务端才是 trust 与有效期的真源（数据飞轮会改它），
// 客户端拿一份编译期的快照，时间一长就会出现「同一处避坑、两端两个核验时间」，
// J2 要求的「AI 说的每个数字能回链」就对不上了。
//
// 为什么保留随包副本：原生壳在没网 / 没配 API base 时必须还能看避坑。
// 但它只是兜底，界面要能说出当前用的是哪一份（factsStamp）。
//
// 状态本身在 factsData.ts：那份不依赖 api.ts，可以被测试直接 import。
import { api } from './api.js';
import { adoptServerFacts } from './factsData.js';
import type { TravelFact } from '../../shared/types/index.js';

/**
 * 从服务端拉一次避坑。成功返回 true 并替换内存里的那份。
 *
 * 失败不抛错、不动现有数据：离线时要能继续用随包副本，这比报错有用。
 */
export async function loadFacts(city?: string): Promise<boolean> {
  try {
    const q = city ? `?city=${encodeURIComponent(city)}` : '';
    const body = await api.get<{ items: TravelFact[] }>(`/api/facts${q}`);
    return adoptServerFacts(body?.items ?? []);
  } catch {
    return false;
  }
}
