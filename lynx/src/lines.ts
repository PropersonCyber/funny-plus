// 原生壳读本地副本：与 places 同一套做法，数据源只有仓库根 data/lines.json 一份。
// 服务端 seed 也读它，两边注入同一份，末班与核载的校验才会给出同一个结论。
import raw from '../../data/lines.json';
import type { TransitLine } from '../../shared/types/index.js';

export const lines = raw as unknown as TransitLine[];
