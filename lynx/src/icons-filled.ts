// 实心（filled）图标：设计稿里 tab 选中态与首页快捷入口用的是实心字形，跟线性图标不是同一套。
// 手写成 SVG，缩放不糊，颜色走参数。
const C = 'currentColor';

export const FILLED: Record<string, string> = {
  // 首页：实心房子
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M11.3 2.6a1.1 1.1 0 0 1 1.4 0l8 6.6c.3.2.4.5.4.8v9.4c0 .9-.7 1.6-1.6 1.6h-4.3v-5.6a1.8 1.8 0 0 0-1.8-1.8h-2.8a1.8 1.8 0 0 0-1.8 1.8V21H4.5c-.9 0-1.6-.7-1.6-1.6V10c0-.3.1-.6.4-.8z"/></svg>`,
  // 地图：实心折叠地图
  map: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M9 3.2 3.6 5.4c-.4.2-.6.5-.6.9v13.2c0 .6.6 1 1.2.8L9 18.2V3.2Z"/><path d="M10.8 18.2 15 19.9V4.6L10.8 3v15.2Z" opacity=".82"/><path d="M16.8 4.6v15.3l3.6-1.5c.4-.2.6-.5.6-.9V4.3c0-.6-.6-1-1.2-.8l-3 1.1Z"/></svg>`,
  // 行程：实心日历
  itinerary: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M7 2.6c.6 0 1 .5 1 1V5h8V3.6a1 1 0 1 1 2 0V5h1.4c1 0 1.8.8 1.8 1.8v12.4c0 1-.8 1.8-1.8 1.8H4.6c-1 0-1.8-.8-1.8-1.8V6.8c0-1 .8-1.8 1.8-1.8H6V3.6c0-.5.4-1 1-1Zm12.2 8.2H4.8v8.2h14.4v-8.2Z"/></svg>`,
  // 避坑：实心盾牌
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M12 2.2 4.4 5v7.2c0 4.3 3.1 7.9 7.6 9.6 4.5-1.7 7.6-5.3 7.6-9.6V5L12 2.2Z"/></svg>`,
  // 我的：实心人像
  profile: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><circle cx="12" cy="7.6" r="4.2"/><path d="M12 13.4c-4.2 0-7.6 2.6-7.6 5.8 0 .7.5 1.2 1.2 1.2h12.8c.7 0 1.2-.5 1.2-1.2 0-3.2-3.4-5.8-7.6-5.8Z"/></svg>`,
  // 热门目的地：实心定位针
  pin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M12 2.4c-3.9 0-7 3-7 6.8 0 4.9 5.6 10.4 6.4 11.2.3.3.9.3 1.2 0 .8-.8 6.4-6.3 6.4-11.2 0-3.8-3.1-6.8-7-6.8Zm0 9.4a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z"/></svg>`,
  // 动漫地图：实心方块地图（设计稿里的菱格地图）
  mapBlock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M4.2 4.4 9.6 2.6v16.8L4.2 21.2V4.4Z"/><path d="M10.9 2.9 15 4.4v16.7l-4.1-1.5V2.9Z" opacity=".78"/><path d="M16.3 4.8 19.8 3.6v16.8l-3.5 1.2V4.8Z"/></svg>`,
  // 智能建议：实心四角星
  sparkle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${C}"><path d="M11 2.8c.2-.6 1-.6 1.2 0l1.6 4.4c.1.3.3.5.6.6l4.4 1.6c.6.2.6 1 0 1.2l-4.4 1.6c-.3.1-.5.3-.6.6L12.2 17c-.2.6-1 .6-1.2 0l-1.6-4.4a1 1 0 0 0-.6-.6L4.4 10.6c-.6-.2-.6-1 0-1.2l4.4-1.6c.3-.1.5-.3.6-.6L11 2.8Z"/><path d="M17.6 15.2c.1-.4.7-.4.8 0l.7 1.9c0 .2.2.3.3.3l1.9.7c.4.1.4.7 0 .8l-1.9.7c-.2 0-.3.2-.3.3l-.7 1.9c-.1.4-.7.4-.8 0l-.7-1.9a.5.5 0 0 0-.3-.3l-1.9-.7c-.4-.1-.4-.7 0-.8l1.9-.7c.2 0 .3-.2.3-.3l.7-1.9Z"/></svg>`,
};

export function filledIcon(name: string, color: string): string {
  return (FILLED[name] ?? '').split('currentColor').join(color);
}
