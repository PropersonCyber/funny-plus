import { describe, expect, it } from 'vitest'
import { stripLocalPhotos } from './photos.ts'

describe('stripLocalPhotos', () => {
  it('只保留 remote，local 与 dataUri 被剥掉', () => {
    const input = {
      photos: [
        { id: 'p1', kind: 'remote', value: 'https://x/1.jpg', addedAt: '2026-11-17T00:00:00Z' },
        { id: 'p2', kind: 'local', value: '/var/1.jpg', addedAt: '2026-11-17T00:00:00Z' },
        { id: 'p3', kind: 'dataUri', value: 'data:image/png;base64,AAA', addedAt: '2026-11-17T00:00:00Z' }
      ]
    }
    expect(stripLocalPhotos(input)).toEqual({
      photos: [{ id: 'p1', kind: 'remote', value: 'https://x/1.jpg', addedAt: '2026-11-17T00:00:00Z' }]
    })
  })

  it('嵌套结构里的照片也剥 —— places 是按 id 的 map', () => {
    const input = {
      overview: 'ok',
      photos: [{ id: 'a', kind: 'local', value: '/a.jpg', addedAt: '' }],
      places: {
        d1: {
          text: 'nice',
          photos: [
            { id: 'b', kind: 'remote', value: 'https://x/2.jpg', addedAt: '' },
            { id: 'c', kind: 'dataUri', value: 'data:...', addedAt: '' }
          ]
        }
      }
    }
    const out = stripLocalPhotos(input) as typeof input
    expect(out.photos).toEqual([])
    expect(out.places.d1.photos).toEqual([{ id: 'b', kind: 'remote', value: 'https://x/2.jpg', addedAt: '' }])
    // 非照片字段必须原样保留
    expect(out.overview).toBe('ok')
    expect(out.places.d1.text).toBe('nice')
  })

  it('没有照片的负载原样返回，不制造空字段', () => {
    const input = { title: 't', summary: 's', picked: { x: true } }
    expect(stripLocalPhotos(input)).toEqual(input)
  })

  it('不修改入参', () => {
    const input = { photos: [{ id: 'p', kind: 'local', value: '/x', addedAt: '' }] }
    stripLocalPhotos(input)
    expect(input.photos).toHaveLength(1)
  })
})
