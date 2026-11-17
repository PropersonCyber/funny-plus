import { useEffect, useState } from '@lynx-js/react';

import { locationStamp } from './geo.js';
import { ensureLocation, readLocationFace, watchLocationFace, type LocationFace } from './locationFace.js';

/** 坐标是异步到的，stamp 变了要再取一次，否则会停在进页面时那一帧 */
export function useLocationFace(): LocationFace {
  const [, bump] = useState(0);
  const stamp = locationStamp();
  useEffect(() => watchLocationFace(() => bump((n) => n + 1)), []);
  useEffect(() => {
    ensureLocation();
  }, [stamp]);
  return readLocationFace();
}
