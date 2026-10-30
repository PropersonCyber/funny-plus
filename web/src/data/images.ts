// 插画已本地化到 public/img：Google CDN 在本机不可达，热链会导致图片全挂


export const CITY_ART: Record<string, string> = {
  成都: '/img/chengdu.jpg',
  重庆: '/img/chongqing.jpg'
}

/** 地图底图（动漫插画） */
export const MAP_ART = '/img/map.jpg'

export const SPOT_ART: Record<string, string> = {
  'cd-panda': '/img/panda.jpg',
  'cd-taikoo': '/img/chunxi.jpg',
  'cd-wuhou': '/img/dufu.jpg',
  'cd-jinli': '/img/jinli.jpg'
}

/** 没配插画的地点用城市图兜底，不留空白框 */
export const spotArt = (placeId: string | undefined, city: string): string =>
  (placeId && SPOT_ART[placeId]) || CITY_ART[city] || ''
