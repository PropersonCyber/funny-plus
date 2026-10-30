// 原生壳暂时读本地副本：lynx 还没有 API base URL，等接上后端再换成 GET /api/places。
// 数据源只有仓库根 data/places.json 一份（server seed 也读它），不要在这里手写条目。
import raw from '../../data/places.json';
import type { Place } from '../../shared/types/index.js';

// JSON 里 open 是 number[]，领域类型要求二元组，这里补齐
export const places = raw as unknown as Place[];
