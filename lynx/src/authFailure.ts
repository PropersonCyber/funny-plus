/**
 * 失败响应要不要清本机 token。
 *
 * 只有 401 才清：`token_expired` 与 `unauthorized` 都意味着「这个 token 不能再用了」，
 * 继续带着它之后每个请求都会 401，用户点什么都失败却看不出原因。
 *
 * 5xx / 网络错误 / 业务错误一律保留：一次服务端抖动就清 token 等于把用户踢下线，
 * 重连后还得再收一次短信验证码。
 *
 * 单独成文件而不是留在 api.ts：rstest 的编译链把 .ts 当 JSX 处理，而 api.ts 里有
 * `<T>(...) =>` 这种泛型箭头函数会被当成标签解析失败，导致任何测试都无法 import 它。
 */
export function authFailureAction(status: number, code: string | undefined): 'clear' | 'keep' {
  if (status !== 401) return 'keep';
  return code === 'token_expired' || code === 'unauthorized' ? 'clear' : 'keep';
}

/** 登录态相关的错误码：只用来决定「要不要提示去登录」 */
export function isAuthFailure(status: number, code: string | undefined): boolean {
  return status === 401 && (code === 'token_expired' || code === 'unauthorized');
}
