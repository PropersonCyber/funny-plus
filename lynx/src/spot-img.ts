// 景点专属插画：行程页和攻略页共用，只有这几个景点有单独出图，其它退回城市封面
import spotKuanzhai from './assets/gen/spot-kuanzhai.jpg';
import spotWuhou from './assets/gen/spot-wuhou.jpg';
import spotPanda from './assets/gen/panda.jpg';
import spotJinli from './assets/gen/jinli.jpg';
import spotChunxi from './assets/gen/chunxi.jpg';

export const SPOT_IMG: Record<string, string> = {
  宽窄巷子: spotKuanzhai,
  武侯祠: spotWuhou,
  大熊猫繁育研究基地: spotPanda,
  锦里: spotJinli,
  太古里: spotChunxi,
  人民公园: spotChunxi,
};

/** 没有专属图就退到城市封面，别让卡片出现空洞 */
export function spotImg(name: string | undefined, fallback: string): string {
  return (name ? SPOT_IMG[name] : undefined) ?? fallback;
}
