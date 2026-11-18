/**
 * 照片上传所需的纯数据转换（F08 后半）。
 *
 * 为什么单独成文件：`photo.ts` 要 import `api.ts`，而 `api.ts` 里有泛型箭头函数
 * （`<T>(path) => ...`），rstest 会把 `.ts` 当 JSX 解析、把 `<T>` 当标签，导致任何
 * import 它的测试都跑不起来。把可测的部分抽出来，这些纯函数才能有单测。
 *
 * 另外不用 `atob`：原生 Lynx 的业务代码跑在 Worker 沙箱里，宿主不保证提供它。
 * 自己实现一张解码表，两端行为一致，也方便测边界。
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 反查表：字符 → 6 bit 值；非法字符不在表里 */
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) LOOKUP[B64[i]] = i;

export type DecodedImage = {
  bytes: Uint8Array;
  mime: string;
};

/**
 * 解析 `data:image/png;base64,...`。
 *
 * 返回 null 表示「不是一个能上传的图片 data URI」—— 调用方据此保留原样，
 * 不要抛错：照片存不进云端不该让回忆页整个失败。
 */
export function parseDataUri(value: string): DecodedImage | null {
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const bytes = base64ToBytes(match[2]);
  if (!bytes || bytes.length === 0) return null;
  return { bytes, mime };
}

/**
 * base64 → 字节。非法字符返回 null（不静默跳过：跳过会让一张坏图变成一张被截断的图）。
 */
export function base64ToBytes(input: string): Uint8Array | null {
  // 去掉 padding 后长度必须是 2/3/4 的三种形态之一，其余说明输入被截断
  const clean = input.replace(/=+$/, '');
  if (clean.length === 0) return null;

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean[i]];
    if (v === undefined) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return outIndex === out.length ? out : out.slice(0, outIndex);
}

/**
 * 数一份草稿里「发布后读者看不到」的照片。
 *
 * 只有 `remote` 能跨设备访问；`local` 是壳层路径、`dataUri` 是内联数据，两者都进不了
 * 分享快照。发布前把这个数如实告诉用户，比发出去之后再解释「为什么照片没了」好。
 */
export function countUnshareable(
  photos: { kind: string }[],
  sections: { items: { photos: { kind: string }[] }[] }[]
): number {
  let n = 0;
  for (const p of photos) if (p.kind !== 'remote') n += 1;
  for (const s of sections) for (const it of s.items) for (const p of it.photos) if (p.kind !== 'remote') n += 1;
  return n;
}
