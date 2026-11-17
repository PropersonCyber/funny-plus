/**
 * A2UI 最小探针（临时脚手架，第一期验收后删除）。
 *
 * 只回答三个问题：渲染器能不能在 Lynx 4.2.0 上画出自定义组件、动作能不能回传、
 * 不装可选 peer @lynx-js/lynx-ui 时能不能构建。不接任何业务数据。
 *
 * 独立 entry，不进主 bundle，因此业务代码零改动。
 * 全部用内联 style：check:css 门禁只对 className 与 src 里的 CSS 对账，探针不引入 class。
 */
import { root, useMemo, useState } from '@lynx-js/react';
import { A2UI, createMessageStore } from '@lynx-js/genui/a2ui';
import type { GenericComponentProps, ServerToClientMessage } from '@lynx-js/genui/a2ui';

/** 自定义 catalog 组件：props 由协议消息直接透传，动作只带一个标识 */
function ProbeCard(props: GenericComponentProps) {
  const title = typeof props.title === 'string' ? props.title : '(缺 title)';
  const detail = typeof props.detail === 'string' ? props.detail : '(缺 detail)';
  const previewId = typeof props.previewId === 'string' ? props.previewId : '';

  const fire = (name: string) => () => {
    props.sendAction?.({ event: { name, context: { previewId } } });
  };

  return (
    <view style={{ padding: '12px', backgroundColor: '#F2F6FF', borderRadius: '10px' }}>
      <text style={{ fontSize: '15px', fontWeight: '600', color: '#2A3A57' }}>{title}</text>
      <text style={{ fontSize: '13px', color: '#5A6B87', marginTop: '6px' }}>{detail}</text>
      <view style={{ marginTop: '10px', display: 'flex', flexDirection: 'row' }}>
        <view bindtap={fire('confirm')} style={{ padding: '6px 12px', backgroundColor: '#2478F2', borderRadius: '6px' }}>
          <text style={{ fontSize: '13px', color: '#FFFFFF' }}>确认应用</text>
        </view>
        <view bindtap={fire('cancel')} style={{ padding: '6px 12px', marginLeft: '8px', backgroundColor: '#E4EAF5', borderRadius: '6px' }}>
          <text style={{ fontSize: '13px', color: '#2A3A57' }}>先不改</text>
        </view>
      </view>
    </view>
  );
}

/** 协议消息里的 component 名取自 displayName ?? name */
ProbeCard.displayName = 'ProbeCard';

/**
 * catalogId 必须是三方一致的那个字符串：渲染器用 surface.catalogId 去查组件表，
 * createSurface 不写它就是 undefined，组件会一律判成「不支持」。
 * 默认值来自 A2UIProps 的 catalogId 缺省。
 */
const PROBE_CATALOG_ID = 'https://unpkg.com/@lynx-js/genui/a2ui/dist/catalog.json';

const FIXED_MESSAGES: ServerToClientMessage[] = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'probe-surface',
      catalogId: PROBE_CATALOG_ID,
      components: [
        {
          id: 'root',
          component: 'ProbeCard',
          title: '第二天轻松一点',
          detail: '时间-40 分钟 · 人均没变',
          previewId: 'probe-preview-1',
        },
      ],
    },
  },
];

function Probe() {
  const [log, setLog] = useState('还没有收到动作');

  const store = useMemo(() => {
    const s = createMessageStore();
    s.push(FIXED_MESSAGES);
    return s;
  }, []);

  return (
    <view style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
      <text style={{ fontSize: '17px', fontWeight: '700', color: '#2A3A57' }}>A2UI 探针</text>
      <text style={{ fontSize: '12px', color: '#8A97AC', marginTop: '4px', marginBottom: '12px' }}>
        固定消息 + 自定义组件，不接业务数据
      </text>

      <A2UI
        messageStore={store}
        catalogs={[ProbeCard]}
        onAction={(action) => setLog(`动作 ${action.name} / context=${JSON.stringify(action.context)}`)}
        renderEmpty={() => <text style={{ fontSize: '13px', color: '#8A97AC' }}>surface 未就绪</text>}
        renderError={(err) => (
          <text style={{ fontSize: '13px', color: '#C0392B' }}>渲染错误：{String(err)}</text>
        )}
        renderUnsupported={(info) => (
          <text style={{ fontSize: '13px', color: '#C0392B' }}>
            不支持：{JSON.stringify(info)}
          </text>
        )}
      />

      <text style={{ fontSize: '13px', color: '#2A3A57', marginTop: '14px' }}>{log}</text>
    </view>
  );
}

root.render(<Probe />);