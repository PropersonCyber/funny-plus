/**
 * 城市封面图映射：热门城市列表页和选择出发城市页都用这一份。
 *
 * 之前只写在 CityListPage 里，第二个页面要用时如果各抄一遍，
 * 加城市就得记着改两处——漏一处就是一张图静默变成成都。
 *
 * 北京/成都/重庆/大理这四张是首页正在用的老图，另外四张是这一版新生成的，
 * 分开命名（*_new）是为了改封面时不会顺手把首页一起换掉。
 */

import chengdu from './gen/chengdu_new.jpg';
import chongqing from './gen/chongqing_new.jpg';
import beijing from './gen/beijing_new.jpg';
import dali from './gen/dali_new.jpg';
import hangzhou from './gen/hangzhou.jpg';
import lijiang from './gen/lijiang.jpg';
import xian from './gen/xian.jpg';
import zhangjiajie from './gen/zhangjiajie.jpg';

export const CITY_IMG: Record<string, string> = {
  chengdu,
  chongqing,
  beijing,
  dali,
  hangzhou,
  lijiang,
  xian,
  zhangjiajie,
};

/**
 * 取封面。缺图必须有兜底：少一张图就让整页白屏，比缺图本身严重得多。
 */
export function cover(key: string): string {
  return CITY_IMG[key] ?? chengdu;
}
