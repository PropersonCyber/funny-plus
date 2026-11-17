import { useCallback, useState } from '@lynx-js/react';

/**
 * 子页路由。
 *
 * 之前是 `route` 一个 string 加 29 处 `setRoute('xxx')`，加一个页面要同时改
 * 类型联合、三元链、所有调用点。现在收成两件事：
 *   go(name, params) 进子页（可带参数）
 *   back() 回 tab
 * 加页面只改 RouteName 一处。
 *
 * 参数（guideId / playId / cityId）跟路由一起管：它们只在各自子页存活期间有意义，
 * 分开存的话「先进攻略详情、再进玩法详情」会看到上一次残留的值。
 */
export type RouteName =
  | 'advice'
  | 'assistant'
  | 'city'
  | 'cityList'
  | 'detail'
  | 'guide'
  | 'guideDraft'
  | 'guides'
  | 'hot'
  | 'memory'
  | 'play';
export type RouteParams = {
  /** 攻略详情要展示哪一条 */
  guideId: string;
  /** 玩法详情要展示哪一条 */
  playId: string;
  /** 热门城市详情要展示哪一座 */
  cityId: string;
};

const EMPTY_PARAMS: RouteParams = { guideId: '', playId: '', cityId: '' };

export function useRoute() {
  // 设计稿里的「智能建议」不是 tab，是从首页快捷入口进的子页，所以 route 与 tab 并存
  const [route, setRoute] = useState<RouteName | null>(null);
  const [params, setParams] = useState<RouteParams>(EMPTY_PARAMS);

  const go = useCallback((name: RouteName, patch?: Partial<RouteParams>) => {
    if (patch) setParams((prev) => ({ ...prev, ...patch }));
    setRoute(name);
  }, []);

  const back = useCallback(() => setRoute(null), []);

  return { route, params, go, back };
}
