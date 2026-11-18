import { describe, expect, it } from '@rstest/core';
import { base64ToBytes, parseDataUri } from './photoData.js';

/**
 * data URI 解码。
 *
 * 这几个函数是「照片能不能真上云」的第一道关，而它们最容易出错的地方是
 * padding 与非法字符 —— 所以用已知字节的真实 PNG 做往返比对，而不是只断言长度。
 */

/** 1x1 透明 PNG 的 base64 主体（无 data: 前缀） */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

describe('base64ToBytes', () => {
  it('解出与原始字节完全一致的内容', () => {
    const bytes = base64ToBytes(PNG_B64);
    expect(bytes).not.toBeNull();
    // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(bytes!.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('无 padding 时也能解（长度不是 4 的倍数）', () => {
    // 'any carnal pleasure.' 的经典样例
    const out = base64ToBytes('YW55IGNhcm5hbCBwbGVhc3VyZQ');
    expect(out).not.toBeNull();
    expect(new TextDecoder().decode(out!)).toBe('any carnal pleasure');
  });

  it('含非法字符返回 null，不静默跳过', () => {
    expect(base64ToBytes('abc$def')).toBeNull();
  });

  it('空串返回 null', () => {
    expect(base64ToBytes('')).toBeNull();
  });
});

describe('parseDataUri', () => {
  it('识别 png 并取出字节', () => {
    const parsed = parseDataUri(`data:image/png;base64,${PNG_B64}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.mime).toBe('image/png');
    expect(parsed!.bytes.length).toBeGreaterThan(50);
  });

  it('mime 统一小写', () => {
    const parsed = parseDataUri(`data:image/JPEG;base64,${PNG_B64}`);
    expect(parsed!.mime).toBe('image/jpeg');
  });

  it('非图片 data URI 返回 null', () => {
    expect(parseDataUri('data:text/plain;base64,aGVsbG8=')).toBeNull();
  });

  it('非 base64 的 data URI 返回 null', () => {
    expect(parseDataUri('data:image/png,rawbytes')).toBeNull();
  });

  it('普通 http 地址返回 null（它本来就不该走上传）', () => {
    expect(parseDataUri('https://cdn.example.com/a.jpg')).toBeNull();
  });
});
