// 原生壳暂时读本地副本：lynx 还没有 API base URL，等原生端接上后端再换成 GET /api/facts。
// 服务端的权威数据在 server/src/db/seed.ts，改内容时两边一起改。
import type { TravelFact } from '../../shared/types/index.js';

export const facts: TravelFact[] = [
  {
    id: 'f-cq-1',
    city: '重庆',
    category: '预约与门票',
    content: '长江索道需线上实名预约分时段票，现场排队可能超 1 小时。',
    scope: '重庆 · 长江索道',
    source: '景区官方公众号',
    verifiedAt: '2025-09-18',
    validUntil: '2025-12-31',
    trust: 'official'
  },
  {
    id: 'f-cq-2',
    city: '重庆',
    category: '交通与路线',
    content: '洪崖洞到解放碑步行约 15 分钟，但电梯与楼梯混行，带老人建议打车绕行。',
    scope: '重庆 · 渝中半岛',
    source: '本地用户经验（3 条一致）',
    verifiedAt: '2025-08-30',
    trust: 'experience'
  },
  {
    id: 'f-cq-3',
    city: '重庆',
    category: '额外消费',
    content: '洪崖洞观光电梯单程收费，夜景楼层观景台另有消费门槛，非强制。',
    scope: '重庆 · 洪崖洞',
    source: '第三方攻略，未见官方说明',
    verifiedAt: '2025-07-12',
    trust: 'pending'
  },
  {
    id: 'f-cd-1',
    city: '成都',
    category: '预约与门票',
    content: '熊猫基地建议 7:30 前入场，10 点后幼年熊猫多回舍，观赏性明显下降。',
    scope: '成都 · 熊猫基地',
    source: '基地官网入园须知',
    verifiedAt: '2025-09-25',
    validUntil: '2026-03-31',
    trust: 'official'
  },
  {
    id: 'f-cd-2',
    city: '成都',
    category: '交通与路线',
    content: '东郊记忆距市中心约 8 公里，地铁 8 号线可直达，晚高峰打车 30 分钟以上。',
    scope: '成都 · 东郊记忆',
    source: '地图服务实时路况',
    verifiedAt: '2025-09-20',
    trust: 'credible'
  },
  {
    id: 'f-cd-3',
    city: '成都',
    category: '天气与人流',
    content: '节假日宽窄巷子 11:00-16:00 拥挤，可改为早上 9 点前或傍晚入场。',
    scope: '成都 · 宽窄巷子',
    source: '文旅部门客流提示',
    verifiedAt: '2025-09-01',
    validUntil: '2025-10-08',
    trust: 'credible'
  }
]
