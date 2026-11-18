import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * 照片上传与读回。
 *
 * `env.ts` 在模块初始化时读一次 `MEDIA_DIR`，所以这里不靠提前设环境变量，
 * 而是每个用例直接改写 `media.dir` —— 它是个普通对象属性，改完后续请求立即生效。
 *
 * 用系统临时目录而不是仓库内目录：测试跑完必须一行不留，落在仓库里迟早被误提交。
 */

const { app } = await import('../app.ts')
const { db, pool } = await import('../db/client.ts')
const { photos, users, authSessions, smsCodes } = await import('../db/schema.ts')
const { media } = await import('../env.ts')

const P1 = '13900000001'

/** 1x1 透明的合法 PNG（67 字节），用来验证真实字节往返 */
const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(like(smsCodes.phone, '139000000%'))
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.phone, P1))
  for (const u of rows) {
    await db.delete(photos).where(eq(photos.userId, u.id))
    await db.delete(authSessions).where(eq(authSessions.userId, u.id))
    await db.delete(users).where(eq(users.id, u.id))
  }
}

async function login(phone: string): Promise<string> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456' })
  })
  const body = (await res.json()) as { token?: string }
  return String(body.token ?? '')
}

function form(bytes: Uint8Array, mime: string, filename = 'a.png'): FormData {
  const fd = new FormData()
  // File 在 Node 20+ 是全局的；类型上要断言，服务端 tsconfig 不含 lib.dom
  // 用 Buffer 直接构造 File：服务端 tsconfig 无 DOM lib，BlobPart/Uint8Array 都过不了类型
  const file = new File([Buffer.from(bytes)], filename, { type: mime })
  fd.append('file', file)
  return fd
}

let workDir = ''

beforeEach(async () => {
  await cleanup()
  // 每个用例一个干净临时目录，避免上一个用例的残留文件影响断言
  workDir = await mkdtemp(path.join(tmpdir(), 'fp-photo-'))
  ;(media as { dir: string }).dir = workDir
})

afterAll(async () => {
  await cleanup()
  if (workDir) await rm(workDir, { recursive: true, force: true })
  await pool.end()
})

describe('照片上传', () => {
  it('未登录上传返回 401', async () => {
    const res = await app.request('/api/photos', { method: 'POST', body: form(PNG_1PX, 'image/png') })
    expect(res.status).toBe(401)
  })

  it('合法图片上传后返回可访问的 url，且公开 GET 读回字节一致', async () => {
    const token = await login(P1)
    const res = await app.request('/api/photos', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form(PNG_1PX, 'image/png')
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; url: string }
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(body.url).toContain(`/api/photos/${body.id}`)

    // 不带任何 Authorization：分享页访客就是这样取图的
    const got = await app.request(`/api/photos/${body.id}`)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('cache-control')).toContain('immutable')
    const back = new Uint8Array(await got.arrayBuffer())
    expect(Array.from(back)).toEqual(Array.from(PNG_1PX))
  })

  it('非图片类型返回 415', async () => {
    const token = await login(P1)
    const res = await app.request('/api/photos', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form(new Uint8Array([1, 2, 3]), 'text/plain', 'a.txt')
    })
    expect(res.status).toBe(415)
    expect(((await res.json()) as { code: string }).code).toBe('unsupported_type')
  })

  it('超过上限返回 413 且不落盘', async () => {
    const token = await login(P1)
    const before = (media as { maxBytes: number }).maxBytes
    try {
      // 把上限压到 10 字节，避免真的造一个 5MB 的 buffer 进测试
      ;(media as { maxBytes: number }).maxBytes = 10
      const res = await app.request('/api/photos', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form(PNG_1PX, 'image/png')
      })
      expect(res.status).toBe(413)
      expect(((await res.json()) as { code: string }).code).toBe('too_large')
    } finally {
      ;(media as { maxBytes: number }).maxBytes = before
    }
    // 被拒的上传不能留下任何行。按本次用户限定，避免受库里其它数据干扰
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.phone, P1))
    const rows = owner
      ? await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, owner.id))
      : []
    expect(rows.length).toBe(0)
  })

  it('存储未配置返回 503', async () => {
    const token = await login(P1)
    const saved = (media as { dir: string }).dir
    try {
      ;(media as { dir: string }).dir = ''
      const res = await app.request('/api/photos', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form(PNG_1PX, 'image/png')
      })
      expect(res.status).toBe(503)
      expect(((await res.json()) as { code: string }).code).toBe('storage_unavailable')
    } finally {
      ;(media as { dir: string }).dir = saved
    }
  })

  it('读不存在的 id 返回 404', async () => {
    const res = await app.request('/api/photos/NOT_A_REAL_ID_000')
    expect(res.status).toBe(404)
  })
})
