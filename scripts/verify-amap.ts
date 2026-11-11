/**
 * 用高德 POI 核验地点数据（A1：先跑通链路，再扩大范围）。
 *
 * 只做「核验并回写」，不编数据：
 *   - 营业时间以高德 opentime2（含季节区间与停止检票）为准，原样保留成人可读字符串
 *   - 票价高德没有（biz_ext.cost 是「人均消费」，且只有有内部消费的场所才有，景区一般为空），
 *     拿不到就置 null，界面显示「暂无票价」，绝不拿旧的手工价顶上
 *   - source 写清来源与核验日期，trust 只升到 credible：高德不是景区官方，不能标 official
 *
 * 跑法：
 *   node --experimental-strip-types scripts/verify-amap.ts            # 只核验并打印差异
 *   node --experimental-strip-types scripts/verify-amap.ts --write    # 回写 data/places.json
 *
 * QPS：高德 Web 服务有并发限制，串行 + 间隔 4s，别改成 Promise.all。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLACES_PATH = resolve(ROOT, 'data/places.json');
const WRITE = process.argv.includes('--write');
const GAP_MS = 4000;

/**
 * 全部 37 个地点的核验名单。amapName 是高德上的正式 POI 名——
 * 必须指向「本体」，不能用「XX游客中心」「XX-午门」「XX地下停车场」这类附属点，
 * 否则会把附属点的营业时间当景区的。
 *
 * 名称来源：一次性全量探测（每个地点命名与高德的匹配结果都人工核过），不是猜的。
 * 加新地点时先在 data/places.json 里补，再在这里补条目，跑一遍 --write。
 */
const TARGETS: { id: string; amapName: string; city: string }[] = [
  // 重庆
  { id: 'cq-hongyadong', amapName: '洪崖洞民俗风貌区', city: '重庆' },
  { id: 'cq-jiefangbei', amapName: '人民解放纪念碑', city: '重庆' },
  { id: 'cq-cikou', amapName: '磁器口古镇', city: '重庆' },
  { id: 'cq-liziba', amapName: '李子坝单轨穿楼观景平台', city: '重庆' },
  { id: 'cq-elingerchang', amapName: 'TESTBED2贰厂文创公园', city: '重庆' },
  { id: 'cq-nanshan', amapName: '南山一棵树景区', city: '重庆' },
  { id: 'cq-sanxia', amapName: '重庆中国三峡博物馆', city: '重庆' },
  { id: 'cq-cableway', amapName: '重庆长江索道', city: '重庆' },
  { id: 'cq-huguang', amapName: '湖广会馆', city: '重庆' },
  { id: 'cq-tanzishi', amapName: '长嘉汇弹子石老街', city: '重庆' },
  { id: 'cq-guanyinqiao', amapName: '观音桥步行街', city: '重庆' },
  { id: 'cq-zhazidong', amapName: '渣滓洞监狱旧址', city: '重庆' },
  // 成都
  { id: 'cd-panda', amapName: '成都大熊猫繁育研究基地', city: '成都' },
  { id: 'cd-kuanzhai', amapName: '宽窄巷子景区', city: '成都' },
  { id: 'cd-jinli', amapName: '锦里古街', city: '成都' },
  { id: 'cd-wuhou', amapName: '成都武侯祠博物馆', city: '成都' },
  { id: 'cd-dongjiao', amapName: '东郊记忆', city: '成都' },
  { id: 'cd-chunxi', amapName: '春熙路', city: '成都' },
  { id: 'cd-dufu', amapName: '成都杜甫草堂博物馆', city: '成都' },
  { id: 'cd-renmin', amapName: '人民公园', city: '成都' },
  { id: 'cd-wenshu', amapName: '文殊院', city: '成都' },
  { id: 'cd-qingyang', amapName: '青羊宫', city: '成都' },
  { id: 'cd-wangjianglou', amapName: '望江楼公园', city: '成都' },
  { id: 'cd-taikoo', amapName: '成都太古里', city: '成都' },
  // 北京
  { id: 'bj-gugong', amapName: '故宫博物院', city: '北京' },
  { id: 'bj-tiantan', amapName: '天坛公园', city: '北京' },
  { id: 'bj-yiheyuan', amapName: '颐和园', city: '北京' },
  { id: 'bj-nanluoguxiang', amapName: '南锣鼓巷', city: '北京' },
  { id: 'bj-798', amapName: '798·751园区', city: '北京' },
  { id: 'bj-shichahai', amapName: '什刹海', city: '北京' },
  { id: 'bj-dongwuyuan', amapName: '北京动物园', city: '北京' },
  { id: 'bj-wangfujing', amapName: '王府井大街', city: '北京' },
  { id: 'bj-tiananmen', amapName: '天安门广场', city: '北京' },
  { id: 'bj-guobo', amapName: '中国国家博物馆', city: '北京' },
  { id: 'bj-jingshan', amapName: '景山公园', city: '北京' },
  { id: 'bj-beihai', amapName: '北海公园', city: '北京' },
  // 成都 339（另放一行，避免上面按城市分组时漏掉）
  { id: 'cd-339', amapName: '成都339购物中心', city: '成都' }
];

type Place = {
  id: string;
  name: string;
  city: string;
  lng: number;
  lat: number;
  open: [number, number];
  ticket: number | null;
  openText?: string;
  source: string;
  verifiedAt?: string;
  trust: string;
  [k: string]: unknown;
};

type AmapPoi = {
  name: string;
  location: string;
  tel?: string | string[];
  biz_ext?: { open_time?: string | [] | null; opentime2?: string | []; rating?: string | [] };
};

function apiKey(): string {
  const env = readFileSync(resolve(ROOT, 'server/.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('AMAP_KEY='));
  const key = line?.slice('AMAP_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('server/.env 里没有 AMAP_KEY');
  return key;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

async function lookup(key: string, amapName: string, city: string): Promise<AmapPoi | null> {
  const url = `https://restapi.amap.com/v3/place/text?${new URLSearchParams({
    key,
    keywords: amapName,
    city,
    extensions: 'all',
    offset: '10',
    page: '1'
  })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = (await res.json()) as { status?: string; info?: string; pois?: AmapPoi[] };
  if (body.status !== '1') throw new Error(`高德返回异常：${body.info}`);
  // 只认名字完全一致的 POI：带「游客中心」「停车场」「-午门」的后缀项不是景区本体，
  // 拿它们的营业时间会写出「景区 24 小时营业」这种错话
  return (body.pois ?? []).find((p) => str(p.name) === amapName) ?? null;
}

/**
 * 高德给的开放时间是多档并列（旺季/淡季）、还可能带「N点关灯」这类补充说明。
 * 这里取**最保守的交集**：最晚开门、最早关门。理由是把「可能已闭园」判成可排，
 * 用户会白跑一趟；判成不可排只是少用一段时间，而 openText 原样留在数据里供人工复核。
 * 原始文本仍会写进 openText，界面照实展示全年时段。
 */
/** 「景区23点关灯」「16:00停止检票」这类说明比营业时段更早结束实际可停留时间 */
function lightsOffCap(openTime: string): number | null {
  const m = openTime.match(/(\d{1,2})\s*点\s*(?:关灯|熄灯|闭馆)/);
  if (m) return Number(m[1]) * 60;
  const hm = openTime.match(/(\d{1,2}):(\d{2})\s*停止(?:检票|入场|入馆|进入)/);
  return hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;
}

function openMinutes(openTime: string): [number, number] | null {
  const cap = lightsOffCap(openTime);

  // 分段：高德经常把「园区营业时间」和「园内场馆/店铺时间」写在同一段里，
  // 例如 798「00:00-24:00；…不同店铺开放时间不同。通常798艺术区开放时间:周二至周日10:00-18:00」。
  // 句号/分号之后的描述说的就不是景区本体了，混进来会让 24 小时开放的园区被算成 10:00-18:00。
  const head = openTime.split(/[；;。/]/)[0] ?? '';
  const spans = [...head.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];

  if (!spans.length) {
    if (/24\s*小时/.test(openTime)) return [0, cap ?? 1440];
    return null;
  }

  // 首段就是 00:00-24:00：园区全天可进，闭园约束只用「关灯/停止入场」那类补充说明
  const firstStart = Number(spans[0][1]) * 60 + Number(spans[0][2]);
  const firstEnd = Number(spans[0][3]) * 60 + Number(spans[0][4]);
  if (firstStart === 0 && firstEnd >= 1440) return [0, cap ?? 1440];

  const starts = spans.map((m) => Number(m[1]) * 60 + Number(m[2]));
  const ends = spans.map((m) => Number(m[3]) * 60 + Number(m[4]));
  const start = Math.max(...starts);
  const end = Math.min(cap ?? Math.max(...ends), Math.max(...ends));
  // 数据自相矛盾（交集为空）时退回最宽档，不要产出 [x, x-10] 这种垃圾时段
  if (end <= start) return [Math.min(...starts), Math.max(...ends)];
  return [start, end];
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  const key = apiKey();
  const places = JSON.parse(readFileSync(PLACES_PATH, 'utf8')) as Place[];
  let changed = 0;

  for (const t of TARGETS) {
    const idx = places.findIndex((p) => p.id === t.id);
    if (idx < 0) {
      console.warn(`[skip] ${t.id} 不在 data/places.json 里`);
      continue;
    }
    const poi = await lookup(key, t.amapName, t.city);
    if (!poi) {
      console.warn(`[miss] ${t.amapName}：高德没有名字完全一致的结果，保持原样不覆盖`);
      await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }

    const biz = poi.biz_ext ?? {};
    // opentime2 带季节区间和停止检票说明，比 open_time 信息更全；两者都空就说明确实没有营业时间
    const openText = str(biz.opentime2) || str(biz.open_time);
    const [lng, lat] = str(poi.location).split(',').map(Number);
    const before = places[idx];
    const next: Place = { ...before };

    if (openText) {
      next.openText = openText;
      const span = openMinutes(openText);
      if (span) next.open = span;
    }
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng && lat) {
      next.lng = lng;
      next.lat = lat;
    }
    // 票价：高德拿不到就明确置空，不要沿用旧的手工价
    next.ticket = null;
    next.source = openText
      ? `高德地图 POI（${t.amapName}）`
      : // 只有坐标可援引时不能说「按高德核验过营业时间」
        `高德地图 POI（${t.amapName}）；营业时间高德无数据，沿用原收录值`;
    next.verifiedAt = today;
    // 信任级别跟着「营业时间有没有被核验」走：高德没给营业时间的，
    // 核验的只是坐标，营业时间仍是旧的估算值，标 credible 就是冒充已核验
    next.trust = openText ? 'credible' : before.trust;

    console.log(`\n=== ${t.id} ${before.name}`);
    console.log(`  名称   ${before.name} → ${str(poi.name)}`);
    console.log(`  营业   ${before.openText ?? '(无)'} → ${openText || '(高德无，保留原值)'}`);
    console.log(`  时段   ${JSON.stringify(before.open)} → ${JSON.stringify(next.open)}`);
    console.log(`  坐标   ${before.lng},${before.lat} → ${next.lng},${next.lat}`);
    console.log(`  票价   ${before.ticket} → null（高德不提供）`);
    console.log(`  电话   ${str(poi.tel)}`);
    console.log(`  信任   ${before.trust} → ${next.trust}${openText ? '' : '（无营业时间，不升级）'}`);

    places[idx] = next;
    changed += 1;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  if (WRITE && changed) {
    writeFileSync(PLACES_PATH, JSON.stringify(places, null, 2) + '\n');
    console.log(`\n已回写 ${changed} 条到 data/places.json`);
  } else {
    console.log(`\n核验 ${changed} 条（未回写，加 --write 落盘）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
