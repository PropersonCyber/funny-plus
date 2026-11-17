import type { GenericComponentProps } from '@lynx-js/genui/a2ui';

import { TripRevisionCard } from './TripRevisionCard.js';

/**
 * 预览卡片的 Catalog。
 *
 * 只注册一个组件：本期只换这张卡，不引入任何内置输入类组件，
 * 因此不需要 @lynx-js/lynx-ui（它是可选 peer，见 e2e-report 的实测记录）。
 */

/**
 * catalogId 必须与 createSurface 消息里的 catalogId 逐字相同。
 * 渲染器是拿 surface.catalogId 去查组件表的，缺省就是查不到 —— 所有组件会一律
 * 判成「不支持」然后整体走降级。这个值只是握手用的标识，不需要真实可下载。
 */
export const TRIP_REVISION_CATALOG_ID = 'funnyplus.a2ui.tripRevision.v1';

/** 协议里允许的动作名，与 revisionActions 的白名单一一对应 */
export const REVISION_ACTIONS = ['confirm', 'cancel'] as const;

/** 组件名取自 displayName ?? name，协议消息里的 component 字段必须与之一致 */
export const TRIP_REVISION_COMPONENT = 'TripRevisionCard';

/** 传给 <A2UI catalogs> 的数组：裸组件即可，manifest 只在要序列化给模型时才需要 */
export const TRIP_REVISION_CATALOG = [TripRevisionCard];

export type TripRevisionCardProps = GenericComponentProps & {
  previewId?: unknown;
  reason?: unknown;
  affectedLines?: unknown;
  impactLine?: unknown;
  recheckLine?: unknown;
  engineNote?: unknown;
};