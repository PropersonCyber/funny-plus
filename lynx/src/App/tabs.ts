/**
 * 底部五栏定义。放这里而不是 index.tsx：
 * TabBar 组件和 App 都要用它，写在组件文件里会变成「组件导出常量」的反向依赖。
 */

export const TABS = [
  { id: 'home', title: '首页', icon: 'home' },
  { id: 'map', title: '地图', icon: 'map' },
  { id: 'itinerary', title: '行程', icon: 'itinerary' },
  { id: 'guide', title: '避坑', icon: 'shield' },
  { id: 'profile', title: '我的', icon: 'profile' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
