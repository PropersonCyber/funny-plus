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
const { media } = await import('../env.ts')

const P1 = '13900000001'
const { photos, users, authSessions, smsCodes, guideShares } = await import('../db/schema.ts')
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
    await db.delete(guideShares).where(eq(guideShares.userId, u.id))
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

  it('未发布分享的照片，匿名读不到，本人能读', async () => {
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

    // 只被私人回忆引用：匿名拿 id 也取不走字节（R3）
    const anon = await app.request(`/api/photos/${body.id}`)
    expect(anon.status).toBe(404)
    // 404 不带缓存头：错误响应进共享缓存，会让「没权限」这个结果粘在别人的浏览器上
    expect(anon.headers.get('cache-control')).toBeNull()

    // 本人带 token 能读，且字节一致
    const mine = await app.request(`/api/photos/${body.id}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/png')
    expect(mine.headers.get('cache-control')).toContain('private')
    const back = new Uint8Array(await mine.arrayBuffer())
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

  it('同一张图重复上传复用同一个 id，不再落第二份', async () => {
    const token = await login(P1)
    const up = async () => {
      const res = await app.request('/api/photos', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form(PNG_1PX, 'image/png')
      })
      expect(res.status).toBe(200)
      return (await res.json()) as { id: string; reused?: boolean }
    }
    const first = await up()
    const second = await up()
    expect(second.id).toBe(first.id)
    expect(first.reused).toBeUndefined()
    expect(second.reused).toBe(true)
  })
})


describe('照片归属与删除（R3）', () => {
  /** 传一张照片，返回 id 与作者 userId */
  async function uploadOne(): Promise<{ id: string; token: string; userId: string; mime: string }> {
    const token = await login(P1)
    const res = await app.request('/api/photos', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form(PNG_1PX, 'image/png')
    })
    const body = (await res.json()) as { id: string }
    const [row] = await db.select().from(photos).where(eq(photos.id, body.id))
    return { id: body.id, token, userId: row.userId, mime: row.mime }
  }

  it('被有效分享引用后，匿名可读且可被 CDN 长缓存', async () => {
    const { id, userId } = await uploadOne()
    await db.insert(guideShares).values({
      token: 'r3-public-token',
      draftId: 'r3-draft',
      userId,
      // 快照里照片按 {id, kind:'remote', value} 存，判定认 id 不认 URL
      snapshot: { title: 't', photos: [{ id, kind: 'remote', value: `/api/photos/${id}`, addedAt: '' }] },
      revokedAt: null
    })

    const anon = await app.request(`/api/photos/${id}`)
    expect(anon.status).toBe(200)
    expect(anon.headers.get('cache-control')).toContain('immutable')
    expect(Array.from(new Uint8Array(await anon.arrayBuffer()))).toEqual(Array.from(PNG_1PX))
  })

  it('撤回分享后匿名重新读不到，已发布期间不允许删照片', async () => {
    const { id, token, userId } = await uploadOne()
    await db.insert(guideShares).values({
      token: 'r3-revoke-token',
      draftId: 'r3-draft-2',
      userId,
      snapshot: { title: 't', photos: [{ id, kind: 'remote', value: `/api/photos/${id}`, addedAt: '' }] },
      revokedAt: null
    })

    // 正被有效分享引用：删照片会让别人正在看的攻略裂图
    const blocked = await app.request(`/api/photos/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { code: string }).code).toBe('in_use')

    // 撤回后：匿名读不到，本人能删
    await db.update(guideShares).set({ revokedAt: new Date() }).where(eq(guideShares.token, 'r3-revoke-token'))
    expect((await app.request(`/api/photos/${id}`)).status).toBe(404)

    const gone = await app.request(`/api/photos/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(gone.status).toBe(200)
    // 删完文件也读不到（行已删，走 404 而不是漏字节）
    expect((await app.request(`/api/photos/${id}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404)
  })
})
