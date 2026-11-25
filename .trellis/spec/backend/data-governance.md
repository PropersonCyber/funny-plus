# 数据治理：字段级依据与人工审核（backend spec）

> 状态：2026-11-23 实现并验证（typecheck 0 / lynx 342 / server 256）。
> 范围：`shared/types` 的 `FieldEvidence`、`server/src/data/{reviewSubmission,publishSubmission,fieldEvidenceQuery,trustRules}.ts`、
> `server/src/routes/{submit,fieldEvidence,places,lines,content,ai}.ts`、`shared/engine/{fieldEvidence,validate,lines}.ts`。
>
> **为什么要有这份 spec**：这一层改的是「我们对外声称一个数字有多可信」。改错了不会崩、不报错，
> 只会让用户按一条过期三年的营业时间改行程。所以决策必须写下来，不能只留在 commit message 里。

---

## 1. Scope / Trigger

触发本 spec 的改动类型：

- 新增/修改「数据可信度」相关表、迁移、接口
- 改 `validate.ts` / `lines.ts` 的**校验等级**（`error` ↔ `warn`）
- 任何新增「对外展示事实」的字段（营业时间、票价、班次、坐标）

不适用：纯展示文案、纯查询接口（不带可信状态语义）。

---

## 2. Signatures

### 2.1 数据库

```sql
-- 0021：审核结论落库。只记结论，不改平台事实
ALTER TABLE data_submissions ADD COLUMN reviewed_by   text;
ALTER TABLE data_submissions ADD COLUMN review_reason text;
ALTER TABLE data_submissions ADD COLUMN reviewed_at   timestamptz;

-- 0022：字段级依据。一行 = 一个字段的一次核验
CREATE TABLE field_evidence (
  id text PRIMARY KEY,
  scope text NOT NULL,             -- 'place' | 'line'
  target_id text NOT NULL,
  field text NOT NULL,             -- 与 places / lines 的列同名：openText / ticket / firstBus / lastBus …
  value text NOT NULL,             -- 核验时的值，数字字段存规范化写法
  source text NOT NULL,
  source_url text,
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL,
  valid_until timestamptz,         -- null = 未设有效期
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX field_evidence_target_idx ON field_evidence (scope, target_id, field);

-- 0023：数据版本计数器。三个表的增、改、删都推进它（AI 引擎靠它判断要不要重装）
CREATE TABLE data_version (id text PRIMARY KEY, version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO data_version VALUES ('global', 1);
CREATE FUNCTION bump_data_version() RETURNS trigger AS $$
  BEGIN UPDATE data_version SET version = version + 1, updated_at = now() WHERE id = 'global'; RETURN NULL; END;
$$ LANGUAGE plpgsql;
-- FOR EACH STATEMENT：批量改写只推一次
CREATE TRIGGER places_data_version AFTER INSERT OR UPDATE OR DELETE ON places FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
CREATE TRIGGER lines_data_version AFTER INSERT OR UPDATE OR DELETE ON lines FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
CREATE TRIGGER field_evidence_data_version AFTER INSERT OR UPDATE OR DELETE ON field_evidence FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
```

### 2.2 接口

```ts
GET  /api/field-evidence?scope=place|line&targetId=<id>
  → 200 { items: FieldEvidence[] }   // 按 verifiedAt 倒序
  → 400 { error: '需要有效的对象类型和编号' }

POST /api/submissions                // 行为已变，见 §3.1
  → 201 { item, promoted: false }    // promoted 恒 false：不再自动写入线上表
```

### 2.3 契约类型（`shared/types`）

```ts
export interface FieldEvidence {
  id: string            // 仅用于同一时刻的稳定排序，没有业务含义
  field: string          // 与列同名
  value: string
  source: string
  sourceUrl?: string
  verifiedAt: string     // 完整 ISO 时间戳（不是日期）
  validUntil?: string    // YYYY-MM-DD 日期；缺省 = 未设有效期
}
// ↑ 公开形状。**刻意不含 `verifiedBy`**（审核人只在表里留档，见 §3.7）

interface Place       { trust: TrustLevel; fieldEvidence?: FieldEvidence[] }
interface TransitLine { trust: TrustLevel; fieldEvidence?: FieldEvidence[] }
```

> **两个日期口径不要混**：`verifiedAt` 是**时刻**，`validUntil` 是**日期**（闭区间）。
> 见 §4.6。

### 2.4 引擎纯函数（`shared/engine/fieldEvidence.ts`）

```ts
evidenceFor(list, field): FieldEvidence | undefined              // 同字段取最新：先比 verifiedAt，再比 id
isEvidenceExpired(e, today?): boolean                            // validUntil < today
sameFieldValue(expected, evidenceValue): boolean                 // 时刻兼容 1020 / 17:00；时段按分钟对；文本只拉平空白
parseWindow(text): [number, number] | null                      // '09:00-17:00' / '540-1020' → 分钟对
evidenceNote(e, today?): string                                  // 「依据 X · 核验于 Y [· 已过有效期]」
openNote(place, today?): string                                  // 优先字段依据，退回行级来源

// 能不能参与硬约束，以及为什么不能
type FieldVerdict = 'ok' | 'missing' | 'expired' | 'mismatch' | 'noBaseline' | 'untrustedRow'
// expected：时刻传分钟数，文本传原文，开放时段传分钟对
judgeField(list, field, expected, rowTrust, today?): FieldVerdict
```

**`expected` 必填**：就是当前实际用于计算的那个值（时刻传分钟数、文本传原文）。
不传它，就等于允许「依据说 17:00、线路已经改成 18:00」也能算核验过。

### 2.5 CLI

```bash
npm run review:submissions                      # 只读：待核验队列
npm run review:submissions -- verified <id> <审核人> <依据>
npm run review:submissions -- rejected <id> <审核人> <依据>
npm run review:submissions -- publish  <id> <来源名称> <来源网址>
npm run add:field-evidence -- place|line <id> <字段> <值> <来源> <核验人> [来源网址]
```

---

## 3. Contracts

### 3.1 用户补录不再自动写入线上表

**以前**：同一字段两个独立设备填同一个值 → 自动写 `lines` / `places`。
**现在**：一律 `status='pending'`，人工 `verified` 后再手动 `publish`。

> **为什么改**（这是本次最重要的一条决策）：
> `clientId` 是客户端自报的。同一个人换两个字符串就能自导自演「两个设备一致」，
> 把一条未经核验的班次写进线上表；而这条班次随后会经 `canJudgeLineHard` 去**拦用户改行程**。
> 「多设备一致」证明不了「这个值是对的」，它只能证明「有人填过」。

### 3.2 审与发分离

`reviewSubmission` 只写 `status/reviewedBy/reviewReason/reviewedAt`，**不动平台事实**。
`publishSubmission` 才写 `lines` / `places`，且在**同一事务**里同时写 `field_evidence`。

> **为什么分离**：审核是「这个值可不可信」的判断，发布是「要不要对外用它」的决定。
> 合成一步，运营就没有「先确认、稍后再上」的余地，只能要么全拒要么全放。

### 3.3 发布的三条限制

1. **只在原字段为空时写**（`isNull(column)`，并在并发下再挡一次）
2. **写的同时把该行压到「用户填报」档**（`capTrust`，最高 `experience`）
3. **发布后才 `invalidateEngine()`**

> **为什么限制 1**：补录是补缺，不是覆盖已核验的值。改写已有事实必须走人工审核后的显式操作，
> 否则任何人都能通过补录把官方的票价顶掉。
> **为什么限制 2**：`trust` 是行级字段。官方行吸收一条用户填报后仍顶着 `official`，
> 再经 `canJudgeLineHard` 就能用用户填的末班去判硬冲突 —— 等于让用户数据冒充官方数据。
> **为什么限制 3**：服务端引擎是进程级单例（见 §4.2）。

### 3.4 字段级依据优先于行级 trust

```ts
// validate.ts 营业时间冲突
const verdict = judgeField(place.fieldEvidence, 'openWindow', [open[0], open[1]], place.trust)
const isHard = verdict === 'ok'

// lines.ts 班次可判硬：首班与末班各用各的依据
if (line.trust !== 'official' || line.isDemo) return false
canJudgeLineHard(line, 'lastBus')   // 内部 = judgeField(..., 'lastBus', line.lastBus, ...) === 'ok'
canJudgeLineHard(line, 'firstBus')  // 同一个函数，换字段名和对应的值
```

判定顺序：**行级档位 → 有没有该字段依据 → 过没过期 → 值对不对得上**。
没有字段依据 **且** 行级为 `official` 时才退回行级（老数据不许集体降级）。

> **为什么按字段而不是整行**：一个地点的坐标、营业时间和票价可能来自不同来源、分别过期。
> 因为坐标可信就把票价标成可信，是最容易骗过自己的错 —— 而用户没有能力分辨哪一段是核过的。

### 3.5 没有依据时「不带这个键」

序列化器只在 `evidence?.length` 时附加 `fieldEvidence`，否则键都不出现。

> **为什么**：空数组与缺省在类型上同义，但真序列化出去会让前端以为「查过了、只是没有」。
> 那是另一种谎。

### 3.6 班次按字段分别判硬（`firstBus` / `lastBus` 各用各的依据）

`canJudgeLineHard(line, 'firstBus' | 'lastBus')`，两个字段分别调一次，`validate` 不共享布尔值。

> **为什么不能只看末班**：曾写过「判排不下了靠末班，所以只看 `lastBus`」—— 这是错的。
> `validate` 对「早于首班」也发 `error`。把末班的有效依据拿给首班用，
> 就会出现「首班依据已过期却硬拦用户」和「首班依据有效却被当成待核实」两种错。

### 3.7 审核人不出公开响应

`FieldEvidence` 是**公开形状**，不含 `verifiedBy`。审核人只存在 `field_evidence.verified_by` 列。

> **为什么**：这个类型随 `Place` / `TransitLine` 走 `/api/places`、`/api/content`、`/api/lines`，
> 还整包塞进 AI 上下文。多带一个内部身份字段，就等于把「谁核的哪条数据」报给所有调用方。
> 目前没有任何鉴权接口，所以**哪个 HTTP 响应都不带**；等有鉴权再开受控读。

---

## 4. 决策记录（Design Decisions）

### 4.1 为什么「没设有效期」不等于「永久有效」

`isEvidenceExpired` 对无 `validUntil` 的记录返回 `false`（不判过期），
但 `judgeField` 仍要求**有该字段的依据**才算核过。两者一起表达的是「未知」而不是「永久」。

> **为什么**：营业时间这类事实本身会变。把「没设有效期」读成「永远有效」，
> 等于替运营承诺了一件没人承诺过的事。

### 4.2 为什么要两层缓存失效，且版本号必须由触发器维护

- **代次**（`server/src/engineCache.ts`）：`invalidateEngine()` 推进，管**本进程内**的写入。零查询成本。
- **版本号**（`server/src/data/dataVersion.ts` + 迁移 0023）：`data_version` 单行计数器，
  由 `places` / `lines` / `field_evidence` 上的**触发器**在增、改、删时推进。
- `ensureEngine` 两个都比，任一不一致就重装。

> **为什么不能比各表的 `max(updated_at)`**：最大值对两类写入瞎 ——
> 删掉一条非最新记录（最大值不变）、手动 UPDATE 没写 `updated_at`（列默认值只在 insert 生效）。
> 这两种情况下 AI 侧一直用旧数据，且没有任何报错。触发器不依赖写入方记得做任何事。
>
> **为什么不用「谁改了谁 +1」的应用层约定**：同上 —— 漏一处就永久不同步。
>
> **代价**：每个 AI 请求多一条主键查询。

**装载必须串行 + 二次确认**（`server/src/engineLoader.ts`）：

1. 同一时刻只跑一个装载，并发请求共享同一个 Promise。
2. 读完几张表**再问一次版本号**；变了就丢弃这批重来（最多 3 次）。
3. 重试用尽后**再确认一次**，仍不一致就抛错 —— 不许把没确认过的缓存当最新返回。

> **为什么**：两个装载并发完成时，先发的那个可能后完成，它读到的旧值会盖掉新值，
> 而记录的版本号还是新的 —— 之后没有任何请求会纠正它。只做 1 或只做 2 都不够。

### 4.3 为什么批量取依据

`loadFieldEvidence(scope, ids?)` 一次查完再按 `targetId` 分组。

> **为什么**：地点池一次 37 条、线路 5 条，逐条查就是 42 次往返。
> 而三个序列化器（`/api/places`、`/api/content`、`/api/lines`）+ AI 引擎装载都要同一份，
> 分组逻辑只能有一份，否则各写一遍必然有一处忘了带。

### 4.4 为什么 `content.ts` 不再自己写 `toPlace`

原 `routes/content.ts` 复制了一份与 `routes/places.ts:toApi` **完全一致**的序列化器。

> **为什么合并**：两份各改一半，界面内容和地点池就对不上 —— 这正是「使用一致的数据」要求本身。
> 合并时同一次改动里加了 `fieldEvidence`，否则又会出现「一边有依据、一边没有」。

### 4.5 为什么两种 warn 文案必须分开

- 「营业时间待核实」= 没人核过
- 「营业时间依据已过期」= 核过但过期了

> **为什么**：混成一句，运营去补数据时不知道该补哪一类 —— 前者要新建依据，后者只要重核。
> **现在有四种原因**（`judgeField` 的返回值）：依据缺失 / 依据过期 / **依据值与当前不一致** / **没有可比对的原值**。
> 每种的后续动作不同：新建依据 / 重核 / 重新录入 / 先补原文。

### 4.6 为什么 `verifiedAt` 是时刻、`validUntil` 是日期

`verifiedAt` 保留完整 ISO 时间戳，`validUntil` 只留 `YYYY-MM-DD`。
查询必须 `ORDER BY verified_at DESC, id DESC`；`evidenceFor` 也要**自己**比 `id`，不依赖数组顺序。

> **为什么**：曾经两者都裁成日期。于是同一天上午、下午各核一次时两条记录完全相等，
> 「取最新」就变成「取数据库先返回的那条」—— 后核的正更可能被盖掉，
> 而且换一个索引、换一次数据库升级，结果就可能回到旧值，没有任何报错。
>
> **不把 `validUntil` 也改成时刻**：它是一个**日期到日结束**的承诺（「有效到 11-30」），
> 带上午夜时间戳只会让闭区间判定更难读。
>
> **同毫秒的两条谁算新**：没有正确答案，但必须每次答同一个 —— 用 `id` 做稳定次序就够了。

### 4.7 为什么依据要比「值」，不是只比字段名和有效期

`judgeField` 会拿 `expected`（当前实际用于计算的值）去比 `FieldEvidence.value`。

> **为什么**：依据存的是「核验时那个值」。字段之后被改过，旧依据仍写着旧值，
> 而它看上去「在、且没过期」。据此把新值当成已核验，就是用一条根本没针对它的依据去拦用户。
> 典型：依据说末班 17:00，线路已是 18:00 —— 用户被一个从未核过的数字拦住。
>
> **为什么不直接传递多一份数据**：比对只需要「当前值 + 依据」，两者都已经在
> `Place` / `TransitLine` 上，不需要新增查询。

### 4.8 为什么判硬看 `openWindow`，而不是 `openText` 原文

行程能不能排进去，取决于 `openingForDay` 算出的那个窗口（`open` / `seasons`），
不是 `openText` 那句话。所以硬约束的依据挂在 `openWindow` 上，值是分钟对（`540-1020` 或 `09:00-17:00`）；
`openText` 的依据只用于展示来源。

> **为什么**：原文依据证明的是「这句话对不对」，证明不了「从这句话摘出来的数字对不对」。
> 曾经拿 `openText` 当基准，结果原文和依据都是 `09:00-17:00`、而 `seasons` 被改成 16:00 时，
> 16:30 的行程仍被判硬冲突 —— 依据从未证明过 16:00 这个数。
>
> **代价**：已有 `openText` 依据的地点不会自动获得硬约束，要补一条 `openWindow`。
> 这是故意的：宁可提示，也不拿一份没覆盖到实际计算值的依据去拦人。
>
> **对比不来的时段**（带中文标注的原文、分季节窗口）一律 `mismatch` / `missing` → warn。

### 4.9 为什么四种不可判原因要分开

`missing` / `expired` / `mismatch` / `noBaseline` 对应的运营动作完全不同：
新建依据 / 重核 / 重新录入那条依据 / 先补原文。合成一个布尔值，运营就只看到「待核实」。

> **代价**：文案多两句。但跟「补错方向、白花一天」比，便宜。

---

## 5. Validation & Error Matrix

| 输入 | `trust` | 字段依据 | `isHard` | 用户可见结果 |
|---|---|---|---|---|
| 营业时间冲突 | official | 无 | ✅ error | 硬拦截，给替代方案 |
| 营业时间冲突 | official | 有，未过期 | ✅ error | 硬拦截，给替代方案 |
| 营业时间冲突 | official | 有，**已过期** | ❌ warn | 「依据已过期，出发前自行确认」 |
| 营业时间冲突 | official | 有，但值是 `ticket` 的 | ❌ warn | 「待核实」——票价核过 ≠ 营业时间核过 |
| 营业时间冲突 | official | 只有 `openText` 依据，没有 `openWindow` | ❌ warn | 「待核实」——核了原文不等于核了时段 |
| 营业时间冲突 | official | `openWindow` 依据在，但值 ≠ 当日窗口 | ❌ warn | 「依据与当前时段不一致」 |
| 班次超末班 | official | `lastBus` 依据在，但值 ≠ 当前末班 | ❌ warn | 不拦人 |
| 营业时间冲突 | pending | 任意 | ❌ warn | 「待核实，出发前自行确认」 |
| 班次超末班 | official, 非 demo | `lastBus` 依据过期 | ❌ warn | 不拦人 |
| 班次超末班 | official, `isDemo` | 任意 | ❌ warn | 构造数据从不判硬 |
| 早于首班 | official | `firstBus` 依据过期，但 `lastBus` 依据有效 | ❌ warn | 两个字段互不借用（见 §3.6） |
| 早于首班 | official | `firstBus` 依据有效 | ✅ error | 硬拦截 |
| 补录提交 | — | — | — | 201，`status='pending'`，线上表**不变** |
| `publish` 非 `verified` 记录 | — | — | — | 抛错「仅可发布已核验的记录」 |
| `publish` 目标字段已有值 | — | — | — | 抛错「对象不存在或已有事实；不能覆盖」 |
| `publish` 缺来源/网址非法 | — | — | — | 抛错「必须提供来源名称和网址」 |
| `add:field-evidence` 对象不存在 | — | — | — | 抛错「对象不存在」 |

---

## 6. Good / Base / Bad

**Good**：官方公告给出新营业时间 → `add:field-evidence` 录入带 `validUntil` 的依据 →
展示层显示「依据 官网 · 核验于 2026-11-20」→ 到期后自动降为 warn。

**Base**：现有 37 个地点**全都没有** `fieldEvidence` → 行为与改动前完全一致（行级 trust 说了算）。
这是刻意的向后兼容：不许因为新表是空的就集体降级。

**Bad**：把「两个设备填了同一个值」当核验依据直接写库 ——
同一个人换两个 `clientId` 就能伪造，最终会拿用户数据去拦用户。

---

## 7. Tests Required

| 断言点 | 位置 |
|---|---|
| 同字段多条取最新、不同字段互不串用、缺失返回 `undefined` | `lynx/src/fieldEvidence.test.ts` |
| 同一天两次核验按**时刻**分先后；核验时刻完全相同时结果不随数组顺序变 | 同上（`id` 稳定次序） |
| `validUntil` 当天仍有效（闭区间）、无 `validUntil` 不判过期 | 同上 |
| 行级非 official 时字段依据再新也判不了硬 | 同上 |
| 依据过期 / 是别的字段 → 不能判硬 | 同上 |
| 有依据用依据、无依据退回行级来源、都无时「未记录核验时间」 | 同上（`openNote`） |
| 官方+有效依据 → `error`；官方+过期依据 → `warn` 且文案含「依据已过期」 | `lynx/src/engine.test.ts`（走真 `validatePlan`） |
| `GET /api/field-evidence` 按对象读取、隔离其他对象、非法 scope 400 | `server/src/routes/fieldEvidence.test.ts` |
| 同一天的多次核验按时刻倒序，且 `verifiedAt` 不被裁成日期 | 同上 |
| 过期 / 缺该字段 / 完全没依据 三种原因各不相同 | `lynx/src/fieldEvidence.test.ts` |
| 依据值 ≠ 当前值 → `mismatch`；无原值 → `noBaseline`；两者都不判硬 | 同上 |
| `1020` 与 `17:00` 视为同一个末班；空串不等于 0 分钟 | 同上（`sameFieldValue`） |
| 依据核的是旧时段 → 官方档位降 warn 且文案含「不一致」 | `lynx/src/engine.test.ts` |
| 只有 `openText` 依据、没 `openWindow` → 最多 warn | 同上 |
| 时段按分钟对比较：`540-1020` 与 `09:00-17:00` 等价；解析不了返回 null | `lynx/src/fieldEvidence.test.ts` |
| 只有票价依据时，营业时间文案说「待核实」而不是「过期」 | 同上 |
| 末班依据有效、首班依据过期 → `before-firstbus` 为 warn；首班依据有效 → error | 同上（走真 `validatePlan` + `setLines`） |
| `/api/places` 与 `/api/content` 返回同一份依据、无依据的地点不带该键 | 人工探针（2026-11-23，`bj-gugong` 带 1 条，`bj-tiantan` 不带） |
| 新增、**修改**、**删除** 各自推进版本号；每步都重取基线（否则插入会掩盖删除触发器失效） | `server/src/data/dataVersion.test.ts` |
| 预热引擎后从别的进程写库 → 下一次装载看得到；并发装载不互相盖 | `server/src/engineLoader.test.ts` |
| 装载到一半写入新数据 → 最终读到新值（`LOCK TABLE lines` + 等 `pg_stat_activity` 出现锁等待，不用固定睡眠） | 同上 |
| 重试用尽时**抛错**而不是静默返回（`engineLoaderHooks.afterLoad` 每次都改数据） | 同上（注入故障验证过：去掉最后确认这条会红） |

**测试不得改真实数据**：`server/` 的测试连的是开发库。要制造「版本变了」时用
`UPDATE lines SET updated_at = updated_at WHERE false` —— 语句级触发器对 0 行也触发，
一行都不用碰。直接 `SET updated_at = now()` 会把库里所有线路的更新时间改成今天。

**未覆盖**：`review:submissions` / `add:field-evidence` 两个 CLI 只经类型检查，未实跑；
`publishSubmission` 的事务回滚路径无测试（需要构造并发冲突）。
`dataVersion` 只测了 `field_evidence` 这一路了 `places` / `lines` 的 `updated_at` 路径靠人工探针。

---

## 8. Wrong vs Correct

### 8.1 序列化器传参

```ts
// ❌ map 会把数组下标当成第二参数传进去
setPlaces(placeRows.map(dbPlaceToApi))
// ✅ 显式包一层
setPlaces(placeRows.map((r) => dbPlaceToApi(r, placeEv.get(r.id))))
```

> 这个坑在 `factToApi` 上已经踩过一次，`tsc` 会拦（`number` 不能赋给 `FieldEvidence[]`），
> 但**只在第二位有类型约束时才拦**。改任何序列化器签名都要先搜 `map(` 的调用点。

### 8.2 判硬约束

```ts
// ❌ 只看行级档位：三年前核过的营业时间照样能拦用户
const isHard = place.trust === 'official'
// ✅ 有字段依据时以它为准，并拿当前值一起去比
const verdict = judgeField(place.fieldEvidence, 'openWindow', [open[0], open[1]], place.trust)
const isHard = verdict === 'ok'
```

### 8.3 补录写入

```ts
// ❌ 用户填报直接写线上表
await db.update(lines).set({ lastBus: value })
// ✅ 只存待复核；人工 verified 后由 publishSubmission 在事务里写事实 + 证据
await db.insert(dataSubmissions).values({ ...row, status: 'pending' })
```

---

## 9. 仍然开着（不要当成已完成）

- **跨实例缓存失效**：版本号已能跨进程（见 §4.2），但**只覆盖 `places` / `lines` / `field_evidence`**；
  其它表变了引擎不会重装（现在也不需要）。**新增需要 AI 侧感知的表时，必须给它挂同一个触发器**。
- **已有事实的修订 / 冲突处理 / 撤回**：`publishSubmission` 只在空字段写，没有改和撤。
- **审核记录 ↔ 证据没关联**：`field_evidence` 没有 `submission_id` 列，两张表是断开的。
- **行级 trust → 字段级迁移**：两套并存，没有迁移方案；现在靠「有依据用依据」过渡。
- **只有 `openText` / `lastBus` 接了依据**：`ticket`、坐标、`firstBus`、`intervalMin` 都还没接。
- **`openWindow` 依据要人工补**：已有 `openText` 依据不会自动升级成时段依据（见 §4.8）。
- **文本比对是严格相等**（只拉平空白）：`openText` 多一句标注就算不一致。宁可误降级为 warn，不敢误升级为 error。
- **可信管理员身份**：审核人仍是命令行参数，没有认证。
