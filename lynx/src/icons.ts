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

// 功能图标（设计稿配色版，见 assets/icons2）
import aiIcon from './assets/icons2/ai.png';
import mapIcon from './assets/icons2/map.png';
import routeIcon from './assets/icons2/route.png';
import hotelIcon from './assets/icons2/hotel.png';
import ticketIcon from './assets/icons2/ticket.png';
import foodIcon from './assets/icons2/food.png';
import weatherIcon from './assets/icons2/weather.png';
import busIcon from './assets/icons2/bus.png';
import budgetIcon from './assets/icons2/budget.png';
import starIcon from './assets/icons2/star.png';
import shareIcon from './assets/icons2/share.png';
import settingsIcon from './assets/icons2/settings.png';

export const FX = {
  ai: aiIcon, map: mapIcon, route: routeIcon, hotel: hotelIcon, ticket: ticketIcon,
  food: foodIcon, weather: weatherIcon, bus: busIcon, budget: budgetIcon, star: starIcon,
  share: shareIcon, settings: settingsIcon,
};

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
