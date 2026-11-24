import { describe, expect, it } from '@rstest/core';
import { setHostProps, getHostAuth, takeHostAuth, onHostAuth } from './hostBridge.js';
import { visibleProviders } from './authProviders.js';

/**
 * 三方登录回跳（F06 客户端）。
 *
 * 这一组的核心不是「能不能登录」，而是**不该出现按钮/不该假装成功**的两侧：
 * 凭证明明没配时先渲染出按钮，用户点下去才收到 501；
 * 或者壳推来一个空 code，被当成有效凭证去兑换 —— 两种都比不做更糟。
 */

describe('回跳凭证只认带 code 的对象', () => {
  it('写进 __fpAuth 的 code 能被读到', () => {
    takeHostAuth();
    setHostProps({ __fpAuth: { provider: 'wechat', code: 'abc123', at: 1 } });
    expect(getHostAuth()?.code).toBe('abc123');
    expect(getHostAuth()?.provider).toBe('wechat');
  });

  it('空 code 不覆盖已有值 —— 壳初始化时会写一个空壳对象', () => {
    takeHostAuth();
    setHostProps({ __fpAuth: { provider: 'wechat', code: 'good', at: 1 } });
    setHostProps({ __fpAuth: { provider: 'wechat', code: '', at: 2 } });
    expect(getHostAuth()?.code).toBe('good');
  });

  it('takeHostAuth 消费一次后就清空，同一 code 不会被重复兑换', () => {
    takeHostAuth();
    setHostProps({ __fpAuth: { provider: 'apple', code: 'tok', at: 1 } });
    expect(takeHostAuth()?.code).toBe('tok');
    expect(takeHostAuth()).toBeNull();
  });

  it('没有回跳时返回 null', () => {
    takeHostAuth();
    expect(getHostAuth()).toBeNull();
  });
});

describe('订阅：页面已开着时才完成授权也要收到', () => {
  it('先订阅后推送能触发', () => {
    takeHostAuth();
    const got: string[] = [];
    const off = onHostAuth((a) => got.push(String(a.code)));
    setHostProps({ __fpAuth: { provider: 'wechat', code: 'late', at: 1 } });
    expect(got).toEqual(['late']);
    off();
  });

  it('取消订阅后不再收到', () => {
    takeHostAuth();
    const got: string[] = [];
    const off = onHostAuth((a) => got.push(String(a.code)));
    off();
    setHostProps({ __fpAuth: { provider: 'wechat', code: 'after', at: 1 } });
    expect(got).toEqual([]);
  });

  it('单个订阅者抛错不影响其它订阅者', () => {
    takeHostAuth();
    const got: string[] = [];
    const offBad = onHostAuth(() => {
      throw new Error('boom');
    });
    const offGood = onHostAuth((a) => got.push(String(a.code)));
    setHostProps({ __fpAuth: { provider: 'wechat', code: 'x', at: 1 } });
    expect(got).toEqual(['x']);
    offBad();
    offGood();
  });
});

describe('不影响已有通道', () => {
  it('只写定位时不会产生回跳凭证', () => {
    takeHostAuth();
    setHostProps({ __fpLocation: { lng: 104.07, lat: 30.66, accuracy: 30 } });
    expect(getHostAuth()).toBeNull();
  });
});

describe('哪些三方按钮该显示', () => {
  it('未配置的通道不显示 —— 点了必然 501 的入口不如没有', () => {
    expect(
      visibleProviders([
        { id: 'wechat', label: '微信登录', configured: false },
        { id: 'apple', label: '通过 Apple 登录', configured: true },
      ]).map((p) => p.id)
    ).toEqual(['apple']);
  });

  it('全部未配置时返回空数组，页面不出现「或」分隔与按钮', () => {
    expect(visibleProviders([{ id: 'wechat', label: '微信登录', configured: false }])).toEqual([]);
  });

  it('还没问到状态（undefined）时不显示任何按钮', () => {
    expect(visibleProviders(undefined)).toEqual([]);
  });

  it('未知通道 id 不渲染：客户端不认识它的含义', () => {
    expect(visibleProviders([{ id: 'weibo' as never, label: '微博', configured: true }])).toEqual([]);
  });

  it('重复下发的同一通道只显示一次', () => {
    expect(
      visibleProviders([
        { id: 'wechat', label: '微信登录', configured: true },
        { id: 'wechat', label: '微信登录', configured: true },
      ]).length
    ).toBe(1);
  });
});
