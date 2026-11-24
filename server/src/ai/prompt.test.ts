import { describe, expect, it } from 'vitest'
import { CHAT_BASE_PROMPT, CHAT_TASK_PROMPTS, PROMPT_VERSIONS, composePromptVersion, versionOf } from './prompt.ts'

/**
 * 提示词版本（X1 的第二轮）。
 *
 * 上一版是一个全局 `PROMPT_VERSION` 管所有提示词：改一处，所有任务的版本一起变。
 * 回滚对照时反而分不清是哪一块改的、改的那块效果如何 —— 版本号本来就是为了回答这个。
 *
 * 这一组守两件事：每块能独立取号；拼出来的复合版本能反查是哪两块。
 */

describe('按块取版本', () => {
  it('每个提示词都有独立版本号', () => {
    for (const block of Object.keys(PROMPT_VERSIONS)) {
      expect(versionOf(block as keyof typeof PROMPT_VERSIONS)).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    }
  })

  it('base 与各任务块都能单独取到', () => {
    expect(versionOf('base')).toBe(PROMPT_VERSIONS.base)
    expect(versionOf('plan')).toBe(PROMPT_VERSIONS.plan)
    expect(versionOf('narrative')).toBe(PROMPT_VERSIONS.narrative)
  })

  it('取一个不存在的块返回 unknown，不悄悄退化成某个真实版本', () => {
    // 伪造一个越界 key：真实代码里类型不允许，但运行时防御仍要有
    expect(versionOf('nope' as never)).toBe('unknown')
  })
})

describe('复合版本能反查是哪几块', () => {
  it('带任务时拼出 base 与任务两段', () => {
    const v = composePromptVersion({ base: PROMPT_VERSIONS.base, plan: PROMPT_VERSIONS.plan })
    expect(v).toBe(`base@${PROMPT_VERSIONS.base}/plan@${PROMPT_VERSIONS.plan}`)
  })

  it('general 只拼 base 一段 —— 没有任务块就不要编一个', () => {
    const v = composePromptVersion({ base: PROMPT_VERSIONS.base })
    expect(v).toBe(`base@${PROMPT_VERSIONS.base}`)
    expect(v).not.toContain('/')
  })

  it('两段可以按 / 切开分别聚合', () => {
    const v = composePromptVersion({ base: PROMPT_VERSIONS.base, nearby: PROMPT_VERSIONS.nearby })
    const blocks = Object.fromEntries(v.split('/').map((seg) => seg.split('@') as [string, string]))
    expect(blocks.base).toBe(PROMPT_VERSIONS.base)
    expect(blocks.nearby).toBe(PROMPT_VERSIONS.nearby)
  })

  it('空对象拼成空串，不产生一个看起来像版本的字符串', () => {
    expect(composePromptVersion({})).toBe('')
  })

  it('块版本为空值时跳过该段', () => {
    expect(composePromptVersion({ base: PROMPT_VERSIONS.base, plan: '' })).toBe(`base@${PROMPT_VERSIONS.base}`)
  })
})

describe('数据状态口径只在一处定义（避免任务间说法不一致）', () => {
  it('基础提示词包含统一口径的四条', () => {
    expect(CHAT_BASE_PROMPT).toContain('未核实')
    expect(CHAT_BASE_PROMPT).toContain('演示')
    expect(CHAT_BASE_PROMPT).toContain('估算')
    expect(CHAT_BASE_PROMPT).toContain('直线距离')
  })

  it('任务层引用基础口径，不各自另立一套说法', () => {
    // facts 与 nearby 都说「按基础提示词的口径」，而不是重复定义一遍
    expect(CHAT_TASK_PROMPTS.facts).toContain('基础提示词的口径')
    expect(CHAT_TASK_PROMPTS.nearby).toContain('基础提示词的口径')
  })

  it('任务层不再重复声明「未核实票价的叫法」——重复就会出现两套措辞', () => {
    // 基础层已经统一说了；任务层再写一遍就会各自漂移
    const baseMentions = CHAT_BASE_PROMPT.match(/未核实/g)?.length ?? 0
    expect(baseMentions).toBeGreaterThan(0)
    expect(CHAT_TASK_PROMPTS.facts).not.toContain('未核实')
  })
})

describe('按块聚合：改一块时只比那一块', () => {
  it('同一 base、不同任务不会被拆成多组', async () => {
    const { blockVersion } = await import('./metrics.ts')
    const a = blockVersion('base@v1/plan@v2', 'base')
    const b = blockVersion('base@v1/nearby@v3', 'base')
    expect(a).toBe('v1')
    expect(b).toBe('v1')
  })

  it('取任务块时只取那一段', async () => {
    const { blockVersion } = await import('./metrics.ts')
    expect(blockVersion('base@v1/plan@v2', 'plan')).toBe('v2')
  })

  it('块不存在时记 (未记录)，不与别的版本混在一起', async () => {
    const { blockVersion } = await import('./metrics.ts')
    expect(blockVersion('base@v1/plan@v2', 'narrative')).toBe('(未记录)')
  })

  it('老数据（单值版本，无 @）归到 (旧版)，不和新格式混比', async () => {
    const { blockVersion } = await import('./metrics.ts')
    expect(blockVersion('2026-11-23.5', 'base')).toBe('(旧版)')
  })

  it('空版本也是 (旧版)，不产生空 key', async () => {
    const { blockVersion } = await import('./metrics.ts')
    expect(blockVersion('', 'base')).toBe('(旧版)')
  })
})
