import { icon } from './icon-svg.js';

export const COLOR = {
  primary: '#2478F2',
  idle: '#7183A2',
  white: '#FFFFFF',
};

export function tabSvg(name: string, active: boolean): string {
  return icon(name, active ? COLOR.primary : COLOR.idle);
}

export function svgIcon(name: string, color: string = COLOR.primary): string {
  return icon(name, color);
}

// 地图元素（assets/map）
import pinSpot from './assets/map/pin-spot.png';
import markerTodo from './assets/map/marker-todo.png';
import thumbLandmark from './assets/map/thumb-landmark.png';
import thumbTemple from './assets/map/thumb-temple.png';
import thumbFood from './assets/map/thumb-food.png';
import thumbNature from './assets/map/thumb-nature.png';
import thumbSnack from './assets/map/thumb-snack.png';

export const MAP_ART = {
  pinSpot, markerTodo, thumbs: [thumbLandmark, thumbTemple, thumbFood, thumbNature, thumbSnack],
};

// 首页快捷入口：IP 风格的 3D 光泽图标（比线性字形更有质感，跟吉祥物同一套观感）
import qPin from './assets/icons3/pin.png';
import qMap from './assets/icons3/map.png';
import qShield from './assets/icons3/shield.png';
import qSpark from './assets/icons3/spark.png';
import qCalendar from './assets/icons3/calendar.png';
import qFlame from './assets/icons3/flame.png';
import qBackpack from './assets/icons3/backpack.png';
import qBook from './assets/icons3/book.png';
import qEye from './assets/icons3/eye.png';
import qStar from './assets/icons3/star.png';
import qWeather from './assets/icons3/weather.png';
import qTicket from './assets/icons3/ticket.png';

export const QICON = {
  pin: qPin, map: qMap, shield: qShield, spark: qSpark, calendar: qCalendar,
  flame: qFlame, backpack: qBackpack, book: qBook, eye: qEye, star: qStar,
  weather: qWeather, ticket: qTicket,
};
