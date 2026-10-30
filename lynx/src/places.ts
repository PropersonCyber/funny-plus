// 原生壳暂时读本地副本：lynx 还没有 API base URL，等原生端接上后端再换成 GET /api/places。
// 内容与仓库根 data/places.json 同源，改一处要一起改。
import type { Place } from '../../shared/types/index.js';

export const places: Place[] =[
  {
    "id": "cq-hongyadong",
    "name": "洪崖洞",
    "city": "重庆",
    "lng": 106.5796,
    "lat": 29.5588,
    "open": [
      540,
      1380
    ],
    "ticket": 0,
    "stayMin": 90,
    "walk": 2,
    "tags": [
      "夜景",
      "拍照"
    ]
  },
  {
    "id": "cq-jiefangbei",
    "name": "解放碑",
    "city": "重庆",
    "lng": 106.5771,
    "lat": 29.5573,
    "open": [
      0,
      1440
    ],
    "ticket": 0,
    "stayMin": 60,
    "walk": 1,
    "tags": [
      "商圈",
      "小吃"
    ]
  },
  {
    "id": "cd-kuanzhai",
    "name": "宽窄巷子",
    "city": "成都",
    "lng": 104.0556,
    "lat": 30.6697,
    "open": [
      540,
      1320
    ],
    "ticket": 0,
    "stayMin": 90,
    "walk": 2,
    "tags": [
      "老街",
      "人文",
      "打卡"
    ]
  },
  {
    "id": "cd-jinli",
    "name": "锦里古街",
    "city": "成都",
    "lng": 104.048,
    "lat": 30.6437,
    "open": [
      600,
      1380
    ],
    "ticket": 0,
    "stayMin": 90,
    "walk": 2,
    "tags": [
      "老街",
      "夜景",
      "小吃"
    ]
  },
  {
    "id": "cd-panda",
    "name": "成都大熊猫繁育研究基地",
    "city": "成都",
    "lng": 104.1464,
    "lat": 30.7333,
    "open": [
      480,
      1080
    ],
    "ticket": 55,
    "stayMin": 150,
    "walk": 2,
    "tags": [
      "动物",
      "亲子",
      "打卡"
    ]
  },
  {
    "id": "cd-chunxi",
    "name": "春熙路",
    "city": "成都",
    "lng": 104.081,
    "lat": 30.657,
    "open": [
      600,
      1380
    ],
    "ticket": 0,
    "stayMin": 90,
    "walk": 1,
    "tags": [
      "商圈",
      "小吃",
      "拍照"
    ]
  },
  {
    "id": "cd-wuhou",
    "name": "武侯祠",
    "city": "成都",
    "lng": 104.0474,
    "lat": 30.6453,
    "open": [
      480,
      1140
    ],
    "ticket": 50,
    "stayMin": 90,
    "walk": 2,
    "tags": [
      "人文",
      "打卡"
    ]
  }
];
