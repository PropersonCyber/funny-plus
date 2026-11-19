import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';

/**
 * 埋点的 journey / platform 归属（G7）。
 *
 * 这两项决定「能不能按验收旅程出漏斗」，而它们的失效方式很隐蔽：
 * 少一个字段不会报错，只会让某条旅程的漏斗凭空缺一截，看起来像「用户没走到那一步」。
 *
 * 所以要盯住的是「打点那一刻的值被冻进事件里」，不是「上报时的当前值是多少」——
 * 同一次会话里可能先规划后改行程，用上报时的值会把两段混成一段。
 */
import { flush, recent, setJourney, track, trackJourney, trackSessionId } from './track.js';

const originalFetch = globalThis.fetch;

const stubFetch = (onBody: (body: string) => void) => {
  (globalThis as { fetch?: unknown }).fetch = (_input: unknown, init?: RequestInit) => {
    onBody(String(init?.body ?? ''));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
};

beforeEach(async () => {
  setJourney(null);
  stubFetch(() => {});
  // 先冲掉上一条用例留在缓冲里的事件：recent() 返回的是副本，直接改长度没用
  flush();
  await Promise.resolve();
});

afterEach(() => {
  (globalThis as { fetch?: unknown }).fetch = originalFetch;
});

describe('journey 归属', () => {
  it('默认没有旅程，显式设置后能读回', () => {
    expect(trackJourney()).toBeNull();
    setJourney('plan');
    expect(trackJourney()).toBe('plan');
    setJourney(null);
    expect(trackJourney()).toBeNull();
  });

  it('事件冻住打点那一刻的旅程，而不是上报时的', () => {
    setJourney('plan');
    track('plan_submitted');
    setJourney('revise');
    track('revise_open');
    // 上报时 journey 已经是 revise 了，第一条事件必须仍然是 plan
    expect(recent().map((e) => e.journey)).toEqual(['plan', 'revise']);
  });

  it('批量上报里每条事件各自带自己的 journey 与 platform', async () => {
    let body = '';
    stubFetch((b) => {
      body = b;
    });

    setJourney('plan');
    track('plan_submitted');
    setJourney('revise');
    track('revise_open');
    flush();
    await Promise.resolve();

    const sent = JSON.parse(body) as {
      events: { event: string; journey: string | null; platform: string }[];
    };
    expect(sent.events.map((e) => e.event)).toEqual(['plan_submitted', 'revise_open']);
    expect(sent.events.map((e) => e.journey)).toEqual(['plan', 'revise']);
    // web 预览环境没有原生同步桥，platform 必须是 web 而不是 undefined：
    // 恒 null 的列等于白占一个字段，出问题时没法按端切
    expect(sent.events.every((e) => e.platform === 'web')).toBe(true);
  });

  it('sessionId 是冷启动级别的常量，同一会话内不变', () => {
    const first = trackSessionId();
    track('a');
    track('b');
    expect(trackSessionId()).toBe(first);
  });
});