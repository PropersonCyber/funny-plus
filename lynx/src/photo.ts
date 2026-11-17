import { newPhotoId } from './storage.js';
import type { PhotoRef } from './data.js';

/**
 * 照片通道：唯一接触「选照片/取图片地址」的地方。
 *
 * 为什么单独成文件：照片来源会换三轮，而这是全仓唯一需要跟着改的地方。
 *   1. 现在：都不可用。业务 JS 跑在 Worker 沙箱里（`storage.ts` 顶部有实测说明），
 *      `document` 不存在 → 连 `<input type=file>` 都拿不到；壳层也还没有选图代码。
 *   2. 壳层给相册/拍照后：壳按 HostBridge 同一套约定推 `__fpPhoto`，
 *      本文件只负责把它翻译成 PhotoRef。
 *   3. 接上云端存储后：上传成功把 kind 从 'local' 换成 'remote'。
 *
 * 调用方（回忆页）只认 PhotoRef，不关心现在是哪一轮。
 */

/** 壳层推上来的照片载荷；字段名即契约，改这里等于改壳 */
type HostPhoto = {
  id?: string;
  /** 壳层已落盘的本地文件路径 */
  localPath?: string;
  /** 可以直接被 <image src> 消费的地址（壳层若已能给出则优先用它） */
  url?: string;
  width?: number;
  height?: number;
};

/** 当前运行时能不能真的选照片。false 时界面要如实说「待接入」，不能给个点了没反应的按钮 */
export function canPickPhoto(): boolean {
  // 只有 dev 预览这类真有 document 的环境才能开文件选择器；
  // 原生与 web-core Worker 都到不了这里
  return typeof (globalThis as { document?: unknown }).document !== 'undefined';
}

/**
 * 选一张照片。
 *
 * 返回 null 表示「没选成」，调用方不需要区分原因（用户取消 / 能力未接入 /
 * 选中后又读失败都一样：界面上什么都不该变）。
 */
export async function pickPhoto(): Promise<PhotoRef | null> {
  const hosted = await pickFromHost();
  if (hosted) return hosted;
  return pickFromBrowser();
}

/**
 * 壳层通道。
 *
 * 约定：壳层选完图后推 `__fpPhoto`，结构见 HostPhoto。
 * 这里用一次性订阅，避免每次选图都堆一个 listener。
 */
function pickFromHost(): Promise<PhotoRef | null> {
  return new Promise((resolve) => {
    const g = (globalThis as { lynx?: { getJSModule?: (n: string) => unknown } }).lynx;
    const emitter = g?.getJSModule?.('GlobalEventEmitter') as
      | {
          addListener?: (name: string, cb: (p: unknown) => void) => void;
          removeListener?: (name: string, cb: (p: unknown) => void) => void;
        }
      | undefined;
    if (!emitter?.addListener) {
      resolve(null);
      return;
    }

    const onPhoto = (payload: unknown) => {
      emitter.removeListener?.('__fpPhoto', onPhoto);
      // 壳层发的可能是 [{__fpPhoto:{...}}]，也兼容直接发对象（与定位通道同一套兼容）
      const first = Array.isArray(payload) ? payload[0] : payload;
      const raw = ((first as { __fpPhoto?: unknown })?.__fpPhoto ?? first) as HostPhoto | undefined;
      if (!raw) {
        resolve(null);
        return;
      }
      // 壳层给了 url 就用 url（能被 <image> 直接吃），否则退回本地路径，标记为待上传
      const remote = typeof raw.url === 'string' && raw.url;
      const local = typeof raw.localPath === 'string' && raw.localPath;
      if (!remote && !local) {
        resolve(null);
        return;
      }
      resolve({
        id: typeof raw.id === 'string' && raw.id ? raw.id : newPhotoId(),
        kind: remote ? 'remote' : 'local',
        value: (remote || local) as string,
        addedAt: new Date().toISOString()
      });
    };

    emitter.addListener('__fpPhoto', onPhoto);
    // 触发壳层的选图。壳侧需要监听到这个事件后弹相册/相机；
    // 壳没实现时不会有回调，下面的超时负责收尾
    const sender = (globalThis as { lynx?: { getJSModule?: (n: string) => unknown } }).lynx;
    const bridge = sender?.getJSModule?.('GlobalEventEmitter') as
      | { emit?: (name: string, payload: unknown) => void }
      | undefined;
    try {
      bridge?.emit?.('__fpPickPhoto', [{}]);
    } catch {
      // 壳没有这个能力：走超时收尾
    }

    // 等不到壳回调就放弃：不能把「相册被用户关掉」变成永久挂起
    setTimeout(() => {
      emitter.removeListener?.('__fpPhoto', onPhoto);
      resolve(null);
    }, 60000);
  });
}

/**
 * 浏览器预览通道：仅 dev 预览可用（有 document）。
 *
 * 读成 dataUri 而不是 blob URL：blob URL 活不过刷新，存进回忆里下次打开就是坏图。
 * 代价是体积大，因此限 2MB 以内 —— 超了直接放弃并提示，不悄悄降质。
 */
function pickFromBrowser(): Promise<PhotoRef | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return Promise.resolve(null);

  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    let settled = false;
    const finish = (v: PhotoRef | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        console.warn('[photo] 图片超过 2MB，先不做压缩处理');
        finish(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === 'string' ? reader.result : '';
        if (!value.startsWith('data:image/')) {
          finish(null);
          return;
        }
        finish({ id: newPhotoId(), kind: 'dataUri', value, addedAt: new Date().toISOString() });
      };
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    });

    // 用户直接关掉弹窗不会触发 change：靠窗口重新获得焦点收尾
    const win = globalThis as { addEventListener?: (t: string, cb: () => void) => void };
    win.addEventListener?.('focus', () => {
      setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 400);
    });

    doc.body.appendChild(input);
    input.click();
  });
}

/**
 * PhotoRef → 能塞给 <image src> 的字符串。
 *
 * 'local' 原样返回：壳层负责让这个路径可读（通常是 file:// 或自定义 scheme）。
 * 不在这里拼接前缀 —— 猜错前缀会得到一个永远加载失败的 <image>，比空白更难查。
 */
export function photoSrc(ref: PhotoRef): string {
  return ref.value;
}
