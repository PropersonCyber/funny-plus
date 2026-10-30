// 原生壳暂时读本地副本：lynx 还没有 API base URL，等接上后端再换成 GET /api/facts。
// 数据源只有仓库根 data/facts.json 一份（server seed 也读它），不要在这里手写条目。
import raw from '../../data/facts.json';
import type { TravelFact } from '../../shared/types/index.js';

export const facts = raw as TravelFact[];
