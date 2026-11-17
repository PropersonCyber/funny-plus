import { useEffect, useState, useGlobalProps, useGlobalPropsChanged } from '@lynx-js/react';

import { setHostProps } from '../hostBridge.js';

/**
 * 定位通道：把壳推上来的坐标写进 hostBridge。
 *
 * globalProps 只能通过官方 Hook 拿：直接读 globalThis.lynx 在原生和 web 两边都是
 * undefined（实测），坐标是壳经 updateGlobalPropsWithDictionary: 下发的。
 *
 * 为什么要三条路一起订：
 *   1. useGlobalProps() 首帧读一次 —— 城市页首帧就会读定位，等 effect 会先渲染成「定位未接入」。
 *   2. useGlobalPropsChanged —— 坐标是异步推上来的，只读一次永远停在「定位中…」。
 *   3. GlobalEventEmitter —— 部分壳走 sendGlobalEvent 显式推；只靠 globalProps 时实测回调不触发。
 *
 * bump 只用来触发重渲染，坐标本身仍从 hostBridge 读，不复制第二份状态。
 */
export function useLocationChannel(): void {
  setHostProps(useGlobalProps());

  const [, setBump] = useState(0);
  useGlobalPropsChanged((data) => {
    setHostProps(data);
    setBump((n) => n + 1);
  });

  useEffect(() => {
    const g = (globalThis as { lynx?: { getJSModule?: (n: string) => unknown } }).lynx;
    const emitter = g?.getJSModule?.('GlobalEventEmitter') as
      | { addListener?: (name: string, cb: (p: unknown) => void) => void }
      | undefined;
    if (!emitter?.addListener) return;
    emitter.addListener('__fpLocation', (payload) => {
      // 壳发的是 [{ __fpLocation: {...} }]，也兼容直接发对象
      const first = Array.isArray(payload) ? payload[0] : payload;
      const loc = (first as { __fpLocation?: unknown })?.__fpLocation ?? first;
      setHostProps({ __fpLocation: loc });
      setBump((n) => n + 1);
    });
  }, []);
}
