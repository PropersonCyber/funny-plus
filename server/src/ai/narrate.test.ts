import { describe, expect, it } from 'vitest'
import { applyNarrative } from '../ai/narrate.ts'
import type { NarrativeSource } from '../ai/narrate.ts'

/**
 * 叙述对齐（N8 之后：从确定性拼串到模型叙述）。
 *
 * 这一组测的不是模型，而是**模型不可信时我们怎么兜底**：
 * 模型可能会编一句「下午很惬意」，也可能把同一条记录改写两遍。
 * `applyNarrative` 是唯一一道闸，它错了，编造的内容就会直接进用户的公开攻略。
 */

const src = (over: Partial<NarrativeSource> = {}): NarrativeSource => ({
  ref: 'd1:i1',
  day: 1,
  title: '故宫',
  visited: 'yes',
  text: '人很多但值得',
  hasPhotos: false,
  ...over
})

const sources = [
  src({ ref: 'd1:i1', title: '故宫' }),
  src({ ref: 'd1:i2', title: '景山', text: '' }),
  src({ ref: 'd2:i3', title: '后海', visited: 'no', text: '临时改计划没去' })
]

describe('只放行指向真实记录的句子', () => {
  it('sourceRef 对得上的保留', () => {
    const out = applyNarrative([{ sourceRef: 'd1:i1', text: '故宫人很多，但觉得值得' }], sources)
    expect(out).toHaveLength(1)
  })

  it('指向不存在的记录一律丢弃 —— 模型编的评论没有可挂靠的地方', () => {
    const out = applyNarrative(
      [
        { sourceRef: 'd1:i1', text: '故宫人很多，但觉得值得' },
        { sourceRef: 'd9:fake', text: '下午的阳光特别惬意，令人难忘' }
      ],
      sources
    )
    expect(out.map((p) => p.sourceRef)).toEqual(['d1:i1'])
  })

  it('同一条记录的第二句也丢掉 —— 一条只该被改写一次', () => {
    const out = applyNarrative(
      [
        { sourceRef: 'd1:i1', text: '第一句' },
        { sourceRef: 'd1:i1', text: '第二句，模型在加戏' }
      ],
      sources
    )
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('第一句')
  })

  it('空文本不产出空行', () => {
    const out = applyNarrative([{ sourceRef: 'd1:i1', text: '   ' }], sources)
    expect(out).toEqual([])
  })

  it('完全没有段落时返回空数组，调用方据此保留确定性基线', () => {
    expect(applyNarrative([], sources)).toEqual([])
  })
})

describe('未确认到访的记录也能被改写，但不能被当成去过', () => {
  it('unknown 的记录允许出现（它本来就有记录）', () => {
    const list = [src({ ref: 'd1:i9', visited: 'unknown', text: '记了一笔但没确认到访' })]
    const out = applyNarrative([{ sourceRef: 'd1:i9', text: '有一笔记录，尚未确认是否到访' }], list)
    expect(out).toHaveLength(1)
  })

  it('选中的条目由调用方筛过，这一层不额外猜 visited', () => {
    // 输入里没有 ref 的段落仍然被丢弃，与 visited 无关
    expect(applyNarrative([{ sourceRef: 'd3:x', text: '编的' }], sources)).toEqual([])
  })
})
