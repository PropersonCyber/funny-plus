import { describe, expect, it } from 'vitest'
import { renderShareShell } from './shareShell.ts'

/**
 * 分享页外壳的转义。
 *
 * 单独测这一条是因为它出过一次**静默**事故：esc() 换成 hono 的 escapeToBuffer 后，
 * 空数组当 buffer 让 `buffer[0] += str` 从 undefined 开始拼，页面标题变成「undefined标题」。
 * 类型检查和 og 标签的存在性断言都发现不了——标签在、内容错了。
 *
 * 这里不碰数据库：shareShell 是纯函数。
 */
const base = {
  token: 'abc123',
  title: '成都两日',
  summary: '一天吃一天逛。',
  coverUrl: '',
  valid: true,
  origin: 'https://example.com'
}

describe('分享页外壳', () => {
  it('正常标题原样出现，且不带 undefined 前缀', () => {
    const html = renderShareShell(base)
    expect(html).toContain('成都两日')
    // 回归：buffer[0] 未初始化时就是这条先红
    expect(html).not.toContain('undefined')
  })

  it('标题里的标签被转义，不会注入', () => {
    const html = renderShareShell({ ...base, title: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('引号与 & 都被转义（og 属性里的标题也要安全）', () => {
    const html = renderShareShell({ ...base, title: `"双引号" & '单引号'` })
    expect(html).toContain('&quot;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&#39;')
  })

  it('失效链接的标题固定，且不泄露原文', () => {
    const html = renderShareShell({ ...base, valid: false })
    expect(html).toContain('内容已不再公开')
    expect(html).not.toContain('成都两日')
  })
})
