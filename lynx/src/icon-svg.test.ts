import { describe, expect, it } from '@rstest/core';
import { SVG, base64Ascii, icon, svgDataUri } from './icon-svg.js';

/**
 * base64 编码是手写的（Worker / Lynx runtime 里不能假设 btoa 存在），
 * 所以这里既对标准答案，也对真实用到的每个图标做往返校验。
 */
describe('base64Ascii', () => {
  it('RFC 4648 标准向量', () => {
    expect(base64Ascii('')).toBe('');
    expect(base64Ascii('f')).toBe('Zg==');
    expect(base64Ascii('fo')).toBe('Zm8=');
    expect(base64Ascii('foo')).toBe('Zm9v');
    expect(base64Ascii('foob')).toBe('Zm9vYg==');
    expect(base64Ascii('fooba')).toBe('Zm9vYmE=');
    expect(base64Ascii('foobar')).toBe('Zm9vYmFy');
  });

  it('解回来和原文一致', () => {
    const cases = ['<svg/>', 'a', 'ab', 'abc', 'data:image/svg+xml;base64,'];
    for (const c of cases) {
      const b64 = base64Ascii(c);
      // Node 里用 Buffer 反解当作独立参照，不是拿同一套逻辑自证
      expect(Buffer.from(b64, 'base64').toString('ascii')).toBe(c);
    }
  });
});

describe('图标 SVG', () => {
  /** 只含 ASCII 是 base64Ascii 的前提；混进中文会编码出错字 */
  it('全部是纯 ASCII', () => {
    for (const [name, svg] of Object.entries(SVG)) {
      expect({ name, ascii: [...svg].every((ch) => ch.charCodeAt(0) < 128) }).toEqual({ name, ascii: true });
    }
  });

  it('svgDataUri 产出原生 image 认的前缀', () => {
    const uri = svgDataUri('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    // 解码后要还是原样的 SVG，别多一层转义
    const decoded = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('ascii');
    expect(decoded).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it('空图标不产出半截 data URI', () => {
    expect(svgDataUri('')).toBe('');
  });

  it('icon() 把 currentColor 换成具体颜色，且结果可编码', () => {
    const raw = icon('pin', '#2478F2');
    expect(raw).not.toContain('currentColor');
    expect(raw).toContain('#2478F2');
    expect(svgDataUri(raw).startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
