/**
 * 服务端引擎数据（places / lines）的缓存代次。
 *
 * 为什么需要它：`ensureEngine` 把地点池与线路灌进 `shared/engine` 的模块级单例，
 * 之后整个进程不再刷新 —— 这是刻意的，按请求换城市会让并发的两个人互相盖掉地点。
 * 但补录生效（C2）会写 `lines` / `places`，写完之后 AI 侧还在拿旧值，
 * 而客户端走 `/api/places` 是实时查库的，于是同一个末班时刻在两个入口说法不同。
 *
 * 为什么用代次而不是直接让 `routes/submit.ts` import AI 路由：
 * 补录那一侧只该知道「数据变了」，不该知道 AI 路由怎么装载引擎。
 * 路由之间一旦互相 import，迟早连成环，而这种环在 Hono 里表现为
 * 某个 route 的 handler 在模块初始化时是 undefined —— 报错信息完全指不到真正的原因。
 *
 * **代次只管本进程**。别的进程写进来的东西（`add:field-evidence`、`db:seed`、手动 psql）
 * 推不动它，那一半由 `data/dataVersion.ts` 的库内指纹负责，两个一起比。
 */
let generation = 0

/** 数据变了：下一次 `ensureEngine` 必须重新装载，不许用旧缓存 */
export const invalidateEngine = (): void => {
  generation += 1
}

/** 当前代次。装载方记下自己装载时的值，用来判断手里的缓存是不是已经过期 */
export const engineGeneration = (): number => generation
