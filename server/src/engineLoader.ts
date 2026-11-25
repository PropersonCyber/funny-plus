import { db } from './db/client.ts'
import { lines, places } from './db/schema.ts'
import { dataVersion } from './data/dataVersion.ts'
import { loadFieldEvidence } from './data/fieldEvidenceQuery.ts'
import { engineGeneration } from './engineCache.ts'
import { setPlaces } from '@/engine/placeIndex.ts'
import { setLines } from '@/engine/lines.ts'
import { toApi as dbPlaceToApi } from './routes/places.ts'
import { lineToApi } from './routes/lines.ts'

/**
 * 把库里的地点池、线路和字段依据灌进 `shared/engine` 的模块级单例。
 *
 * 为什么一次性灌全量、之后只读：如果按请求灌不同城市的数据，两个用户并发问不同城市
 * 会互相覆盖，A 城市的人拿到 B 城市的地点。
 *
 * **避坑不在这里缓存**：它的可信度依赖反馈与有效期（C1/C3），一旦和地点池一起
 * 缓存到进程生命周期，AI 的回答就永远停在第一次启动时那一档 ——
 * 攻略页因为反馈降了档，AI 还在拿「官方已核验」说话（见 routes/ai.ts 的 getFacts）。
 */

/** 手里这份缓存是按哪个数据版本装的（进程内代次 + 库里的版本号） */
let loadedAtGeneration = -1
let loadedAtVersion = ''
/** 正在跑的装载。并发请求共享同一个，不各自开一份 */
let reloading: Promise<void> | null = null

/**
 * 测试用接缝：每次装载结束后、重新确认版本之前调用。
 *
 * 生产代码里没人设它。存在的原因只有一个：要测「重试耗尽时会不会静默返回」
 * 就得能在那个具体时刻改数据，而那个时刻从外部无法确定地命中。
 */
export const engineLoaderHooks: { afterLoad?: () => Promise<void> | void } = {}

/**
 * 装载一次。
 *
 * **装完要再确认一次版本号**：读取几张表是异步的，这期间数据可能已经被改了。
 * 直接把刚读到的旧值写进共享引擎，就等于用旧值盖掉新值，而记录的版本号还是新的 ——
 * 之后再也没有任何请求会纠正它。发现变了就把这一批丢掉重来。
 */
async function load(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await dataVersion()
    const [placeRows, lineRows, placeEv, lineEv] = await Promise.all([
      db.select().from(places),
      db.select().from(lines),
      // 字段级依据跟数据一起灌：AI 工具与校验要和界面看到同一份依据，
      // 否则「这行营业时间你凭什么说已核验」在对话里答不出来
      loadFieldEvidence('place'),
      loadFieldEvidence('line')
    ])
    if ((await dataVersion()) !== target) continue
    // 显式包一层：两个序列化器的第二位都是可选依据，直接 map 会把数组下标当成它传进去
    setPlaces(placeRows.map((r) => dbPlaceToApi(r, placeEv.get(r.id))))
    setLines(lineRows.map((r) => lineToApi(r, lineEv.get(r.id))))
    loadedAtVersion = target
    loadedAtGeneration = engineGeneration()
    return
  }
  // 三次都在这期间被改完：宁可本次失败，也不要拿一份和库里对不上的数据去回答
  throw new Error('数据在装载期间持续变化，本次请求不用缓存')
}

/** 手里这份缓存是不是库里的最新版 */
async function cacheIsCurrent(): Promise<boolean> {
  return (await dataVersion()) === loadedAtVersion && engineGeneration() === loadedAtGeneration
}

export async function ensureEngine(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 每次问一次库（一条主键查询）。AI 请求本来就要等一次模型调用，这点开销不算什么；
    // 反过来「省掉一次查询」却让数据长期不同步，才是真亏。
    if (await cacheIsCurrent()) return
    // 同一时刻只跑一个装载：两个装载并发完成时，先发的那个可能后完成，
    // 它的旧结果就会盖掉新结果。这里压成一个，配合 load() 里的二次确认。
    reloading ??= load().finally(() => {
      reloading = null
    })
    await reloading
    await engineLoaderHooks.afterLoad?.()
  }
  // 跑满三次说明数据一直在变。这里必须**再确认一次**，不能循环一结束就当成装好了 ——
  // 那样等于把一个未经验证的缓存当最新用，而且不报错，正是这层要防的事。
  if (!(await cacheIsCurrent())) throw new Error('数据一直在变，本次请求不用缓存')
}
