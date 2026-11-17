import { useEffect, useState } from '@lynx-js/react';

import { hydrate } from '../storage.js';

/**
 * 持久层就绪信号。
 *
 * IndexedDB / 注入桥的初始化是异步的，hydrate 之前 loadStore 一律读不到东西。
 * booted 之前：不渲染主界面（闪一下默认行程再跳成存档，比空一下更难接受），
 * 也不允许写档（会把上次的行程覆盖成默认数据）。
 *
 * 只负责「什么时候可以读写」，不碰具体读写什么——行程和内容各自在 booted 之后自己取。
 */
export function useBootstrap(): boolean {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let alive = true;
    hydrate().then(() => {
      if (alive) setBooted(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return booted;
}
