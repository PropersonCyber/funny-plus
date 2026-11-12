import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { amap, amapSign } from '../env.ts'

/**
 * 地图能力代理。前端永远不持有高德 key：
 * Web 服务 key 的私钥一旦进包，签名就形同虚设，而且配了 IP 白名单后客户端 IP 必被拒。
 *
 * 三条约定（前端接入层 src/geo.ts 依赖它们）：
 *   - key 未配置 → 503 + code=not_configured，前端如实降级（继续用直线距离 / 不显示定位城市）
 *   - 高德报错   → 502 + code=upstream_error + 原始 infocode，便于区分 key 失效和平台不匹配
 *   - 查不到结果 → 200 + 空值，不造数据
 */
export const geoRoute = new Hono()

const AMAP_BASE = 'https://restapi.amap.com'
const UPSTREAM_TIMEOUT_MS = 6000

type CacheEntry = { at: number; body: unknown }
const cache = new Map<string, CacheEntry>()
/** 同一路段的耗时不会天天变：缓存一天，省配额也省往返 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX = 800

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.body as T
}

function cacheSet(key: string, body: unknown): void {
  // 满了整体清空比维护 LRU 简单；重建一次只是一次 API 调用，不值得为此写链表
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, { at: Date.now(), body })
}

/**
 * 两站之间的真实路线耗时 + 真实折线。
 * 用 /v3/direction 而不是 /v3/distance：distance 是「多个起点 → 同一个终点」，
 * 而行程要的是 1→2→3 的相邻段，硬套会让每个结果只用一个，配额白烧。
 *
 * 折线（steps[].polyline）一并返回：前端画的才是车真正走的路，不是两点直连。
 */
geoRoute.get('/direction', async (c) => {
  const mode = c.req.query('mode') === 'walking' ? 'walking' : 'driving'
  if (!amap.configured()) return c.json({ error: '地图服务未配置', code: 'not_configured', mode }, 503)

  const origin = c.req.query('origin') ?? ''
  const destination = c.req.query('destination') ?? ''
  const okPoint = (s: string) => {
    const [lng, lat] = s.split(',').map(Number)
    return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  }
  if (!okPoint(origin) || !okPoint(destination)) return c.json({ error: '经纬度不合法', code: 'bad_coord' }, 400)

  const key = `${mode}:${origin}:${destination}`
  const cached = cacheGet<{ durationS: number; distanceM: number; path?: string }>(key)
  if (cached) return c.json({ ...cached, mode, cached: true })

  const params: Record<string, string> = { key: amap.key, origin, destination }
  if (amap.signed()) params.sig = amapSign(params)

  const url = `${AMAP_BASE}/v3/direction/${mode}?${new URLSearchParams(params)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }).catch(() => null)
  if (!res) return c.json({ error: '地图服务不可达', code: 'upstream_error', mode }, 502)

  const body = (await res.json().catch(() => null)) as
    | {
        status?: string
        info?: string
        infocode?: string
        route?: { paths?: { duration?: string; distance?: string; steps?: { polyline?: string }[] }[] }
      }
    | null
  if (!body || body.status !== '1') {
    return c.json({ error: body?.info ?? '地图服务返回异常', code: 'upstream_error', infocode: body?.infocode, mode }, 502)
  }

  const path = body.route?.paths?.[0]
  const durationS = Number(path?.duration ?? 0)
  const distanceM = Number(path?.distance ?? 0)
  // 高德偶尔回状态 1 但路径为空（两点间无路可走）：如实报空，别给 0 让前端当成「就在旁边」
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return c.json({ durationS: 0, distanceM: 0, mode, empty: true })
  }

  // steps[].polyline 是首尾相接的段落，拼起来就是整条路线。
  // 缺任何一段都不拼——拼出来的路会从中间横跳，比不画更差
  const joined = joinPolylines(path?.steps)
  const out = joined ? { durationS, distanceM, path: joined } : { durationS, distanceM }
  cacheSet(key, out)
  return c.json({ ...out, mode, cached: false })
})

/** 一条 16km 的路高德能回上千个点（十几 KB JSON）：服务端先按固定间距粗筛，前端再精修 */
const MAX_PATH_POINTS = 240

function joinPolylines(steps: { polyline?: string }[] | undefined): string {
  if (!Array.isArray(steps) || steps.length === 0) return ''
  const pts: string[] = []
  for (const step of steps) {
    if (typeof step?.polyline !== 'string' || !step.polyline) return ''
    // 相邻 step 的首点通常与上一段末点重合，去掉能省下几百个重复点
    const seg = step.polyline.split(';')
    if (pts.length > 0 && seg[0] === pts[pts.length - 1]) seg.shift()
    pts.push(...seg)
  }
  if (pts.length <= MAX_PATH_POINTS) return pts.join(';')
  // 等距抽稀：保留首尾，中间按步长跳点。形状靠前端 Douglas-Peucker 再收一遍
  const stride = pts.length / MAX_PATH_POINTS
  const picked: string[] = []
  for (let i = 0; i < MAX_PATH_POINTS - 1; i++) picked.push(pts[Math.round(i * stride)])
  picked.push(pts[pts.length - 1])
  return picked.join(';')
}

/** 逆地理：前端拿到经纬度后换城市名，首页「当前定位」用它 */
geoRoute.get('/regeo', async (c) => {
  if (!amap.configured()) return c.json({ error: '地图服务未配置', code: 'not_configured' }, 503)

  const lng = Number(c.req.query('lng'))
  const lat = Number(c.req.query('lat'))
  // 经纬度越界直接拒：高德对非法坐标也会回状态 1 + 空 regeocode，前端会当成「定位到未知地区」
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return c.json({ error: '经纬度不合法', code: 'bad_coord' }, 400)
  }

  const params: Record<string, string> = {
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    key: amap.key,
    // 只要城市名，不要 roads/pois/aois：extensions=all 返回体积大一个量级，缓存也吃亏
    extensions: 'base'
  }
  if (amap.signed()) params.sig = amapSign(params)

  const url = `https://restapi.amap.com/v3/geocode/regeo?${new URLSearchParams(params)}`
  const res = await fetch(url).catch(() => null)
  if (!res) return c.json({ error: '地图服务不可达', code: 'upstream_error' }, 502)

  const body = (await res.json().catch(() => null)) as
    | { status?: string; info?: string; infocode?: string; regeocode?: { addressComponent?: { province?: string; city?: string; district?: string } } }
    | null
  if (!body || body.status !== '1') {
    return c.json({ error: body?.info ?? '地图服务返回异常', code: 'upstream_error', infocode: body?.infocode }, 502)
  }

  const comp = body.regeocode?.addressComponent
  // 直辖市的 city 字段是空数组（高德历史上返回 [] 不是 ''），要退到 province，
  // 否则北京/上海/重庆的用户会定位到空城市
  const city = pickCity(comp?.city) || pickCity(comp?.province)
  return c.json({
    city,
    province: pickCity(comp?.province),
    district: pickCity(comp?.district),
    coord: 'gcj02'
  })
})

/** 高德个别字段空值是 [] 而不是 ''，直接当字符串用会得到 "[]" 这种脏值 */
function pickCity(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

type Point = { lng: number; lat: number }

/**
 * 批量距离：一次最多 100 个起点，正是行程「一天 8 个点两两算耗时」的形状。
 * type=1 驾车（默认）、type=3 步行（单段 <=5km），骑行/公交不在这里做——公交要 city 参数且跨城规则复杂。
 */
geoRoute.post('/distance', async (c) => {
  if (!amap.configured()) return c.json({ error: '地图服务未配置', code: 'not_configured' }, 503)

  const body = (await c.req.json().catch(() => null)) as
    | { origins?: Point[]; destination?: Point; mode?: 'driving' | 'walking' }
    | null
  const origins = body?.origins
  const dest = body?.destination
  const mode = body?.mode === 'walking' ? 'walking' : 'driving'
  if (!Array.isArray(origins) || origins.length === 0 || origins.length > 100 || !dest) {
    return c.json({ error: '起点需 1-100 个，且必须给终点', code: 'bad_param' }, 400)
  }
  const valid = (p: Point) =>
    Number.isFinite(p?.lng) && Number.isFinite(p?.lat) && Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 90
  if (!origins.every(valid) || !valid(dest)) return c.json({ error: '经纬度不合法', code: 'bad_coord' }, 400)

  const params: Record<string, string> = {
    key: amap.key,
    type: mode === 'walking' ? '3' : '1',
    origins: origins.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|'),
    destination: `${dest.lng.toFixed(6)},${dest.lat.toFixed(6)}`
  }
  if (amap.signed()) params.sig = amapSign(params)

  const url = `https://restapi.amap.com/v3/distance?${new URLSearchParams(params)}`
  const res = await fetch(url).catch(() => null)
  if (!res) return c.json({ error: '地图服务不可达', code: 'upstream_error' }, 502)

  const data = (await res.json().catch(() => null)) as
    | { status?: string; info?: string; infocode?: string; results?: { origin_id?: string; distance?: string; duration?: string }[] }
    | null
  if (!data || data.status !== '1' || !Array.isArray(data.results)) {
    return c.json({ error: data?.info ?? '地图服务返回异常', code: 'upstream_error', infocode: data?.infocode }, 502)
  }

  // origin_id 从 1 开始编号，直接用下标对齐，前端按下标取用时不用再解析字符串
  const results = data.results.map((r, i) => ({
    index: r.origin_id ? Number(r.origin_id) - 1 : i,
    distanceM: Number(r.distance ?? 0),
    durationS: Number(r.duration ?? 0)
  }))
  return c.json({ mode, results })
})

/**
 * 静态图 key 只在「确实要用 JS API 渲染底图」时才需要，因此单独一个开关：
 * JS API key 和 Web 服务 key 不通用（混用报 10009），且 securityJsCode 下发到前端后
 * 官方明确禁止本地转存；真接底图时应该改成由服务端出图或走 <webview> 隔离，这里先只占位。
 */
geoRoute.get('/static-config', (c) => {
  const jsKey = (process.env.AMAP_JS_KEY ?? '').trim()
  if (!jsKey) return c.json({ key: '', enable: false, code: 'not_configured' })
  return c.json({ key: jsKey, enable: true })
})

/**
 * 静态地图底图代理。
 *
 * 为什么必须有这一层：
 *   - key 不能下发：Web 服务 key 带私钥签名，进包等于把配额交出去
 *   - 响应可能是图、也可能是 JSON：高德所有失败都回 HTTP 200 + JSON body，
 *     只看状态码会把 {"status":"0"} 当成图，前端拿到一张裂图还没有任何提示
 *
 * 协议 3.5 明令不得「存储、缓存或技术手段抓取」服务图片，
 * 所以这里**不写缓存**，也不加 CDN 头：请求 → 透传 → 丢弃。
 */
geoRoute.get('/staticmap', async (c) => {
  if (!amap.configured()) return c.json({ error: '地图服务未配置', code: 'not_configured' }, 503)

  const parsePoint = (s: string): Point | null => {
    const [lng, lat] = s.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
    return { lng, lat }
  }

  const center = parsePoint(c.req.query('center') ?? '')
  if (!center) return c.json({ error: 'center 需为 lng,lat', code: 'bad_coord' }, 400)

  // 高德会静默夹取：zoom>17 按 17 出、size>1024 按 1024 出。
  // 我们这边先夹，前端拿到的尺寸才是它以为的那个，否则 marker 会整体偏出画面
  const zoomRaw = Number(c.req.query('zoom') ?? 13)
  const zoom = Math.min(17, Math.max(3, Number.isFinite(zoomRaw) ? Math.round(zoomRaw) : 13))

  const [wRaw, hRaw] = (c.req.query('size') ?? '750*900').split('*').map(Number)
  const clampSize = (v: number, d: number) => Math.min(1024, Math.max(64, Number.isFinite(v) ? Math.round(v) : d))
  const w = clampSize(wRaw, 750)
  const h = clampSize(hRaw, 900)

  const scale = c.req.query('scale') === '2' ? '2' : '1'

  const params: Record<string, string> = {
    key: amap.key,
    location: `${center.lng.toFixed(6)},${center.lat.toFixed(6)}`,
    zoom: String(zoom),
    size: `${w}*${h}`,
    scale
  }

  // paths / markers 原样透传，但先做形状校验：
  // 这一层对外是公开接口，不限制字符集就成了任意内容的免费高德出图服务
  for (const name of ['paths', 'markers', 'labels'] as const) {
    const v = c.req.query(name)
    if (!v) continue
    if (v.length > 4000 || !/^[0-9A-Za-z\u4e00-\u9fa5.,:*;|_#@\-]+$/.test(v)) {
      return c.json({ error: `${name} 参数格式不合法`, code: 'bad_param' }, 400)
    }
    params[name] = v
  }

  if (amap.signed()) params.sig = amapSign(params)

  const url = `${AMAP_BASE}/v3/staticmap?${new URLSearchParams(params)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }).catch(() => null)
  if (!res) return c.json({ error: '地图服务不可达', code: 'upstream_error' }, 502)

  const type = res.headers.get('content-type') ?? ''
  // 正常是 image/png；失败是高德回的 JSON（状态码依然是 200）
  if (!type.startsWith('image/')) {
    const body = (await res.json().catch(() => null)) as { info?: string; infocode?: string } | null
    return c.json(
      { error: body?.info ?? '地图服务返回异常', code: 'upstream_error', infocode: body?.infocode },
      502
    )
  }

  const buf = new Uint8Array(await res.arrayBuffer())
  return c.body(buf, 200, {
    'Content-Type': type,
    // 不缓存：协议不允许留存地图图片，也避免把「过期底图」当真相
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  })
})

/**
 * 3D 地图页。
 *
 * key 由服务端注入，前端只拿一个 `/api/geo/map3d` 地址 —— 客户端永远看不到高德 key。
 * 页面用 JS API 2.0 渲染 3D（viewMode + pitch），必须在 DOM 里跑，
 * 所以只能做成独立页面交给 webview / iframe（详见文件的头部说明）。
 */
geoRoute.get('/map3d', async (c) => {
  if (!amap.configured()) return c.text('地图服务未配置', 503)
  const file = new URL('../../public/map3d.html', import.meta.url)
  const html = await readFile(file, 'utf8').catch(() => null)
  if (!html) return c.text('3D 地图页缺失', 500)
  // 只替换占位符，避免 key 出现在响应日志以外的任何地方
  const out = html.replace('__AMAP_KEY_PLACEHOLDER__', amap.key)
  return c.body(out, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  })
})
