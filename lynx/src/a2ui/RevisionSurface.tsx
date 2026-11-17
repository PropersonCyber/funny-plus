import { useMemo } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import { A2UI, createMessageStore } from '@lynx-js/genui/a2ui';
import { RevisionBoundary } from './RevisionBoundary.js';

import type { RevisePreview } from '../../../shared/types/index.js';
import { TRIP_REVISION_CATALOG, TRIP_REVISION_CATALOG_ID } from './catalog.js';
import { parseRevisionAction, type RevisionAction } from './revisionActions.js';
import { revisionMessagesOf } from './revisionMessages.js';

/**
 * 把一份预览交给 A2UI 渲染。
 *
 * 三层职责分开：消息转换在外面（纯函数、可测），动作收敛在 revisionActions，
 * 这里只管生命周期与降级 —— 一旦渲染侧任何环节不认，就必须回到旧卡片，
 * 不能让用户看见空白气泡（spec FR-4）。
 *
 * 每份预览自带 store，并用 key 绑定 previewId：换 store 时渲染器会重建 processor，
 * 上一轮的数据不会漏到下一轮。
 */

type Props = {
  preview: RevisePreview;
  previewId: string;
  /** 动作统一交给业务层；载荷已收敛成 { kind, previewId } */
  onAction: (action: RevisionAction) => void;
  /** 降级时渲染旧卡片。新旧必须共用同一套确认/取消入口（spec FR-4） */
  fallback: () => unknown;
};

export function RevisionSurface({ preview, previewId, onAction, fallback }: Props) {
  const surfaceId = `revision-${previewId}`;

  const store = useMemo(() => {
    const s = createMessageStore();
    try {
      s.push(revisionMessagesOf(preview, previewId, surfaceId, TRIP_REVISION_CATALOG_ID));
    } catch {
      // 转换失败就留空 store：下面 renderEmpty / renderError 会回落到旧卡片
    }
    return s;
  }, [preview, previewId, surfaceId]);

  return (
    <RevisionBoundary fallback={fallback as () => ReactNode}>
      <A2UI
        key={previewId}
        messageStore={store}
        catalogs={TRIP_REVISION_CATALOG}
        catalogId={TRIP_REVISION_CATALOG_ID}
        onAction={(payload) => {
          const action = parseRevisionAction(payload as { name?: unknown; context?: unknown });
          // 未知动作、缺 previewId、类型不对一律丢弃，不往下传
          if (action && action.previewId === previewId) onAction(action);
        }}
        renderEmpty={fallback as () => never}
        renderFallback={fallback as () => never}
        renderError={fallback as () => never}
        renderUnsupported={fallback as () => never}
      />
    </RevisionBoundary>
  );
}