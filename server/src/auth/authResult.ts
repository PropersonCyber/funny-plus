/**
 * 鉴权失败的对外口径。
 *
 * `expired` 必须与其余失败分开：前端只有拿到 `token_expired` 才会清掉本机 token 并引导
 * 重新登录。把过期混进 `unauthorized` 会让客户端无法区分「这台设备从没登录过」与
 * 「登录过但失效了」，前者不该弹登录，后者必须弹。
 */
export type AuthFailure = 'missing' | 'unknown' | 'revoked' | 'expired'

export function describeAuthFailure(kind: AuthFailure): {
  status: 401
  code: 'unauthorized' | 'token_expired'
} {
  return kind === 'expired'
    ? { status: 401, code: 'token_expired' }
    : { status: 401, code: 'unauthorized' }
}
