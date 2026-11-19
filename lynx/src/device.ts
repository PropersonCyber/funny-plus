/**
 * 设备标识。
 *
 * 单独成文件的原因是它必须能被 track.ts 引用，而 track.ts 的测试不能拉进 api.ts ——
 * api.ts 里的 `<T>(path) => ...` 泛型箭头会被 rstest 当成 JSX 解析失败，
 * 整条 import 链上的测试全部跑不起来（photoData.ts / syncStatus.ts / factsData.ts 也是同一个原因拆出来的）。
 *
 * api.ts 仍然 re-export 它，所以老调用点 `import { deviceId } from './api.js'` 不用改。
 */
import { readLocal, writeLocal } from './storage.js';

const CLIENT_KEY = 'funny-plus.client-id.v1';

/**
 * 设备标识：只用于「同一台设备同一条只记一次」。
 * 本机存储拿不到时退回会话内随机 id —— 这会让重启后又被算成新设备，
 * 所以界面上要照实说「只在本次会话有效」，不能假装已长期去重。
 */
let sessionId = '';

export function deviceId(): string {
  const saved = readLocal(CLIENT_KEY);
  if (saved) return saved;
  if (!sessionId) sessionId = `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  writeLocal(CLIENT_KEY, sessionId);
  return sessionId;
}