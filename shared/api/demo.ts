/**
 * 演示模式：URL 加 ?demo=1 就切到固定的测试账号，用它预置的行程与反馈看各种界面状态。
 * 只在本地验证用，不进任何产品流程；?demo=0 关掉。
 */
const KEY = 'funny-plus.demo.v1'

export const DEMO_CLIENT_ID = 'demo-user'

/** hash 路由下 ?demo=1 可能出现在 search 也可能在 hash 后面，两种都认 */
export function demoMode(): boolean {
  try {
    const params = new URLSearchParams(location.search)
    const hashQuery = location.hash.split('?')[1]
    if (hashQuery) new URLSearchParams(hashQuery).forEach((v, k) => params.set(k, v))

    const flag = params.get('demo')
    if (flag === '1') {
      localStorage.setItem(KEY, '1')
      return true
    }
    if (flag === '0') {
      localStorage.removeItem(KEY)
      return false
    }
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
