// 设计稿（docs/proto.png）里的展示数据。价格、评分、天气、距离、预算占比都还没有真实数据源，
// 统一放这里当 mock，接真数据时只换这个文件。
export const MOCK = {
  weather: { temp: '22°C', text: '晴' },

  cities: [
    { id: '成都', tag: '美食 · 熊猫', price: '¥1200 起', image: 'chengdu', open: true },
    { id: '重庆', tag: '山城 · 夜景', price: '¥1500 起', image: 'chongqing', open: true },
    { id: '大理', tag: '自然风光', price: '¥1800 起', image: 'dali', open: true },
  ],

  // 首页「最近计划」
  recentPlan: {
    title: '成都 3天2晚',
    meta: '4 人 · ¥3000/人',
    status: '未成行',
  },

  // 地图页三个视图 + 推荐玩法
  mapTabs: ['行程路线', '景点列表', '推荐玩法'],
  playStyles: [
    { title: '拍照出片', note: '老街与夜景机位', icon: 'sparkles' },
    { title: '美食探店', note: '本地小吃与火锅', icon: 'food' },
    { title: '亲子慢游', note: '少走路多体验', icon: 'pin' },
  ],

  // 行程详情页
  tripDetail: {
    meta: [
      { icon: 'profile', label: '2 人', note: '同行人数' },
      { icon: 'budget', label: '¥3000/人', note: '人均预算' },
      { icon: 'transport', label: '高铁 + 公交', note: '出行方式' },
    ],
    arrive: { title: '抵达成都 · 酒店办理入住', cost: 300, hours: 1 },
    daySummaries: [
      { title: '宽窄巷子 · 锦里古街 · 大熊猫基地', price: '¥980/人', duration: '6小时50分' },
      { title: '金沙遗址 · 杜甫草堂 · 春熙路', price: '¥1020/人', duration: '7小时20分' },
      { title: '东郊记忆 · 返程', price: '¥260/人', duration: '4小时10分' },
    ],
  },

  trip: {
    title: '成都 · 3天2晚',
    dateRange: '4月18日 – 4月20日',
    party: 2,
    budgetPerPerson: 3000,
    style: ['经典路线', '美食探索', '适合朋友'],
  },

  days: [
    { index: 1, date: '4月18日', weekday: '周五' },
    { index: 2, date: '4月19日', weekday: '周六' },
    { index: 3, date: '4月20日', weekday: '周日' },
  ],

  // 时间轴上每条的两张示例图沿用城市插画
  advice: {
    transport: {
      title: '高铁 + 公交',
      perPerson: '¥980',
      tags: ['时间可控', '费用适中', '市区交通便利，适合2人出行'],
      crossPrice: '人均¥986',
    },
    hotel: {
      title: '春熙路/太古里商圈',
      note: '距离市中心商圈较近 · ¥400-600/晚',
      tags: ['交通便利', '美食丰富', '购物方便'],
    },
    budgetSplit: [
      { label: '交通', percent: 35, color: '#2478F2' },
      { label: '住宿', percent: 25, color: '#35C7E8' },
      { label: '门票', percent: 20, color: '#45D6B0' },
      { label: '餐饮', percent: 15, color: '#FFBE55' },
      { label: '其他', percent: 5, color: '#A5B2C7' },
    ],
  },

  guideCategories: ['全部', '门票预约', '交通与路线', '天气与人流', '价格与消费'],

  profile: {
    name: '旅行小达人',
    level: 'Lv1 旅行新手',
    stats: [
      { num: '3', label: '旅行计划' },
      { num: '12', label: '收藏地点' },
      { num: '5', label: '打卡足迹' },
    ],
    member: '开通会员，享受更多 AI 规划与专属权益',
    menu: [
      { icon: 'route', title: '我的行程' },
      { icon: 'pin', title: '我的收藏' },
      { icon: 'itinerary', title: '旅行足迹' },
      { icon: 'budget', title: '预算账单' },
      { icon: 'food', title: '同行人管理' },
      { icon: 'search', title: '帮助与反馈' },
      { icon: 'settings', title: '设置' },
    ],
  },

  assistant: {
    greeting: '你好！我是你的旅行助手，你可以告诉我：',
    abilities: ['想要调整行程', '需要推荐景点', '想控制预算', '了解更多避坑信息'],
    userMessage: '帮我把第二天的行程改成轻松点，去一些小众景点',
    reply: '已为你调整第二天行程',
    replyNote:
      '我已将第二天的行程调整为更轻松的路线，主要以文化体验和小众景点为主，减少了长途移动，并保持了原有预算不变。',
    suggestion: '查看调整详情',
    placeholder: '有什么问题都可以问我…',
  },

  // 避坑页页尾横幅
  guideBanner: '更多避坑信息 · 旅行更安心',
};
