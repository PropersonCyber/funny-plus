import { useEffect, useState } from '@lynx-js/react';

/**
 * 全局轻提示。
 * 为什么要有：入口点了没反应，用户分不清是「没做」还是「卡住了」。
 * 本期没有目标页面的入口（会员、分享、攻略详情…）一律弹一句实话，而不是静默。
 */
type Msg = { text: string; id: number };

const listeners = new Set<(m: Msg) => void>();
let seq = 0;

export function toast(text: string): void {
  if (!text) return;
  const msg = { text, id: ++seq };
  listeners.forEach((fn) => fn(msg));
}

const PILL = {
  backgroundColor: 'rgba(23,43,77,0.92)',
  borderRadius: '18px',
  padding: '9px 16px',
  maxWidth: '78%',
} as const;

export function ToastHost() {
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    const fn = (m: Msg) => setMsg(m);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  // 换一条消息要重新计时，所以按 msg 整个对象做依赖
  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(timer);
  }, [msg]);

  if (!msg) return null;

  return (
    // 只占底部一条横带，不铺满全屏：铺满时一旦 pointerEvents 不生效，整页都点不动
    <view
      style={{
        position: 'absolute',
        left: '0',
        right: '0',
        bottom: '96px',
        zIndex: '99',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <view style={PILL}>
        <text style={{ color: '#FFFFFF', fontSize: '13px', lineHeight: '19px' }}>{msg.text}</text>
      </view>
    </view>
  );
}
