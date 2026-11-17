import { describe, expect, it } from '@rstest/core';

import { authFailureAction } from './authFailure.js';

/**
 * 401 的分支判定是纯函数，单独测它：
 *
 * - `token_expired` / `unauthorized` → 清本机 token。不清的话坏 token 会一直被带上，
 *   之后每个请求都是 401，用户点什么都失败却看不出原因。
 * - 5xx 与网络错误 → 保留 token。一次服务端抖动就清 token 等于把用户踢下线，
 *   而且重连后还得重新收一次短信验证码。
 *
 * 不 mock fetch 打真后端：这里要验的是「客户端怎么判」，不是「服务端返回什么」。
 */
describe('authFailureAction', () => {
  it('401 + token_expired 判定为清 token', () => {
    expect(authFailureAction(401, 'token_expired')).toBe('clear');
  });

  it('401 + unauthorized 也清（登出或被吊销后不该继续带）', () => {
    expect(authFailureAction(401, 'unauthorized')).toBe('clear');
  });

  it('5xx 保留 token —— 服务端出错不等于登录失效', () => {
    expect(authFailureAction(500, undefined)).toBe('keep');
    expect(authFailureAction(503, undefined)).toBe('keep');
  });

  it('400 / 409 等业务错误保留 token', () => {
    expect(authFailureAction(400, 'bad_param')).toBe('keep');
    expect(authFailureAction(409, 'stale_write')).toBe('keep');
    expect(authFailureAction(429, 'too_frequent')).toBe('keep');
  });
});
