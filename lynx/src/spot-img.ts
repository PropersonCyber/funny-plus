// 景点配图：行程页、攻略页、城市详情页共用。实拍风，与设计稿一致；没有配图的地点退回城市封面
import spotKuanzhai from './assets/gen/spot-kuanzhai.jpg';
import spotWuhou from './assets/gen/spot-wuhou.jpg';
import spotPanda from './assets/gen/panda.jpg';
import spotJinli from './assets/gen/jinli.jpg';
import spotChunxi from './assets/gen/chunxi.jpg';
import spot339 from './assets/gen/spot-339.jpg';
import spotTiananmen from './assets/gen/spot-tiananmen.jpg';
import spotTiantan from './assets/gen/spot-tiantan.jpg';
import spotGuobo from './assets/gen/spot-guobo.jpg';
import spotJiefangbei from './assets/gen/spot-jiefangbei.jpg';
import spotCableway from './assets/gen/spot-cableway.jpg';
import spotHongyadong from './assets/gen/spot-hongyadong.jpg';
import spotGugong from './assets/gen/spot-gugong.jpg';
import spotChunxiSt from './assets/gen/spot-chunxi.jpg';
import spotLiziba from './assets/gen/spot-liziba.jpg';

export const SPOT_IMG: Record<string, string> = {
  宽窄巷子: spotKuanzhai,
  武侯祠: spotWuhou,
  大熊猫繁育研究基地: spotPanda,
  锦里: spotJinli,
  太古里: spotChunxi,
  人民公园: spotChunxi,
  洪崖洞: spotHongyadong,
  解放碑: spotJiefangbei,
  长江索道: spotCableway,
  天安门广场: spotTiananmen,
  天坛公园: spotTiantan,
  中国国家博物馆: spotGuobo,
  成都339: spot339,
  故宫博物院: spotGugong,
  春熙路: spotChunxiSt,
  李子坝轻轨站: spotLiziba,
};

/**
 * 没有专属图就退到城市封面，别让卡片出现空洞。
 *
 * 不能只做精确匹配：数据里的名字带城市前缀（「成都大熊猫繁育研究基地」）、
 * 或者多一个字（「锦里古街」），精确匹配会静默退到城市封面——看着像「这个点没有图」，
 * 实际是查表没命中。按包含关系兜一层。
 */
export function spotImg(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const exact = SPOT_IMG[name];
  if (exact) return exact;
  const key = Object.keys(SPOT_IMG).find((k) => name.includes(k) || k.includes(name));
  return key ? SPOT_IMG[key] : fallback;
}
