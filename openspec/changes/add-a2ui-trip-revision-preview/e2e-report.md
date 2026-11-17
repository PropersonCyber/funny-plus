# E2E / 等价验收报告: add-a2ui-trip-revision-preview

状态：**已验收**。2026-11-17 完成 Web 实跑与 iOS 真机验收，Android 按用户裁决不单独验。下文数字均为实测，未跑过的项在「已知限制与残余风险」里点名。

## 验收范围

对齐 `docs/spec-a2ui-trip-revision.md` §7 的 AC-01 ~ AC-09（AC-04 拆 a / b），以及本 change 的
`specs/a2ui-trip-revision/spec.md` 全部 Scenario。

## 分层验证计划

| 层 | 覆盖 | 手段 | 对应任务 |
| --- | --- | --- | --- |
| L1 契约 | `RevisePreview` → A2UI v1.0 消息转换、动作白名单 | rstest 纯函数用例（TDD） | 3.1 ~ 3.3 |
| L2 行为 | previewId 路由、防重、过期判定、状态转换 | rstest 纯函数用例（TDD） | 4.1 ~ 4.4 |
| L3 联调 | 流式 / 非流式双通道、引擎兜底、不重复请求 | 真实服务端对话 | 6.1 ~ 6.2 |
| L4 实机 | 三端渲染等价、降级回落、导航与过期路径 | Web / iOS 手动运行 + 截图 | 1.3 / 5.3 / 6.3 |

渲染层降级按裁决走真机验收，本期不新建组件渲染测试基建；降级捕获能力用一次性用例验证后即删，不作为常规测试保留。

## 命令与退出码

移除探针 entry 后的最终态：

| 命令 | 退出码 | 时间 | 备注 |
| --- | --- | --- | --- |
| `npm --prefix lynx run typecheck` | 0 | ~1s | 与移除前一致，无残留引用 |
| `npm --prefix lynx run build` | 0 | 6~7s | 含 `check:css`（710 个 class 对上）；主 bundle 12341.2 kB(web) / 12217.1 kB(lynx) |
| `npm --prefix lynx run test` | 0 | 2.46s | **15 个文件 / 143 个用例全通过** |

分阶段记录（保留过程，便于对照）：

| 阶段 | 用例数 | 主 bundle（lynx） |
| --- | --- | --- |
| 接入前基线 | 122 | 12031.8 kB |
| 任务 2 后（revisionState 落地） | 130 | 12034.0 kB |
| 任务 3~5 后（消息适配器 / 动作白名单 / catalog） | 143 | 12217.1 kB（**+185.3 kB**） |
| 移除探针 entry 后 | 143 | 12217.1 kB（不变） |

探针独立 entry 曾为 258.1 kB(web) / 273.4 kB(lynx)，验收后已连同 `src/a2ui/probe.tsx` 删除，不再产出。

## 双通道联调（任务 6.1）

同一行程 `demo-trip-2`（重庆 2 天 4 人，Day1 解放碑 / 弹子石老街，Day2 观音桥商圈）+ 同一指令「第二天换成洪崖洞」，两条通道各跑一次：

| 通道 | 请求 | 耗时 | `by` | `affected` | `impact` |
| --- | --- | --- | --- | --- | --- |
| 非流式 | `POST /api/ai/chat` `stream:false` | 9.4s | `model` | `[观音桥商圈：换成「洪崖洞」]` | `{minutes:30, cost:0, recheck:[]}` |
| 流式 | `POST /api/ai/chat` `stream:true` | 6.9s | `model` | 同上 | 同上 |

流式响应事件构成：7 个 `delta` / 2 个 `tool`（`queryPlaces`、`proposeRevise`）/ 2 个 `tool_result` / 1 个 `done`。从 `tool_result.proposeRevise` 解出的 `by`、`affected`、`impact` 与非流式**逐字段一致**。

两条路径在客户端都汇入 `lynx/src/aiChat.ts` 的同一个 `readToolResult`，展示层只读 `reason / affected / impact / by`，因此 `impact.note` 的措辞差异（两通道模型输出不同）不会进入卡片（`revisionMessages.ts:44-57`）。

## 三端实机证据

| 端 | 环境 | 场景 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| Web | rspeedy dev @ 3001 | 最小探针：固定消息 + 自定义 `ProbeCard` + 确认/先不改 | `browser-screenshot-1794896335901.jpg` | **通过**：卡片渲染正确，动作回传 `confirm`，载荷 `{"previewId":"probe-preview-1"}` |
| Web | 同上 + 真实服务端 | 真实对话 → 预览 → 确认 → 去行程页核对（任务 2.3） | `browser-screenshot-1794898080033.jpg` | **通过**：确认后仍停在对话页、显示「已写进行程」、确认按钮消失、出现「去行程页核对」；点它跳行程页，Day 2 只剩 1 个地点、时间 -70 分钟、人均没变，与预览一致 |
| Web | 同上，A2UI 卡片（任务 5） | 真实对话 → A2UI 卡片渲染 → 卡内确认 | `browser-screenshot-1794899791480.jpg` | **通过**：surface `surface-revision-rev-mwkcz59i-1` 渲染出原因 / 「宽窄巷子：换成「锦里古街」」/「时间没变 · 人均没变」/ 两个按钮；在 surface 内点确认后动作回传、状态转 applied、surface 卸载由旧卡片接管显示「已写进行程」 |
| Web | 框架内 | 降级捕获：子组件渲染期抛错 | 一次性 rstest 渲染用例 | **通过**：断言 fallback 渲染出旧卡片文本、未向上抛；控制台打 `[a2ui] 预览卡片渲染失败，已回落旧卡片： Error: boom`（AC-05 抛错分支） |
| iOS | Lynx 4.2.0（vendor pod） | 首页 → 助手 → 生成预览 → 确认 → 取消 → 过期路径 | 用户 2026-11-17 真机执行 | **通过**（用户回报） |
| Android | lynx 4.2.0 AAR | — | — | **不验**：用户 2026-11-17 明确「Android 不用验，iOS 验过即可」 |

## 依赖与体积记录

| 项 | 值 |
| --- | --- |
| `@lynx-js/genui` | 0.8.0（实测安装成功） |
| `@lynx-js/lynx-ui` | **未安装**。registry 标为 optional peer，不装也能构建成功（已实测）。只有内置 Modal / TextField / Slider / RadioGroup / ChoicePicker / DateTimeInput 才需要它 |
| `@lynx-js/react` | 0.126.2（未被顶版） |
| `@lynx-js/react-signals` | 0.0.7（随 genui 装上；peer 上限 0.129） |
| 嵌套副本 | `@lynx-js/react-rsbuild-plugin` 出现两份（仓内 0.20.4 + genui 自带 0.22.3），构建无冲突 |
| bundle 体积增量（实测） | 主 bundle web 12169.3 → **12341.2 kB**、lynx 12031.8 → **12217.1 kB**（+185.3 kB）。探针 entry 已删除 |

## 服务端与持久化未改动（任务 6.2）

- `git diff --stat 5d0733e..HEAD -- server/ shared/` 为空；工作区 `git diff -- server/ shared/` 亦为空。
- 降级不触发第二次模型请求：`RevisionSurface.tsx` / `RevisionBoundary.tsx` 内无任何 `fetch` / `revise` / `chat` 调用，`fallback` 只渲染旧卡片；A2UI 子树除 `onAction` 外没有对外回调（AC-07）。

## 已知限制与残余风险

- **服务端 `by === 'engine'` 分支未端到端跑过**：该分支要求 `aiConfigured()` 为 false（清空 AI key 后重启服务端）。本轮服务端 AI 开启，模型始终给出判定，走不到兜底。展示契约已由用例覆盖（`revisionMessages.test.ts:82`：`by='engine'` → `engineNote='这次没连上模型，是按关键词识别的改动'`），但「真降级时卡片长什么样」没有截图。
- **`ReviseSheet` 本地兜底产的预览 `affected` 为 `[]`**（`ReviseSheet/index.tsx:55`），服务端路径则带元素。两条路落到同一张卡片，因此本地兜底那版卡片没有明细行 —— 符合「`affectedLines` 为空则不产出明细行」的既有约定，但若后续要在兜底场景也展示改了什么，需补引擎输出。
- **取消与过期路径只有用例级覆盖**：`revisionState.test.ts` 断言了三类过期与取消丢弃；Web 端未留实跑截图。
- `@lynx-js/lynx-ui` 未安装（optional peer），仅影响内置输入类组件，本变更未使用。
- genui 自带 `@lynx-js/react-rsbuild-plugin@0.22.3` 与仓内 `0.20.4` 并存，构建无冲突但体积上有冗余。

## 验收结论

- 结论: **通过**。AC-01 ~ AC-09 均有实测或可执行用例覆盖，Web 实跑 + iOS 真机双端确认。
- 阻塞项: 无。
- 残余风险: 见上节，其中「服务端 engine 兜底路径未端到端跑」是唯一没有实跑证据的分支。
- 归档建议: **可以归档**。`probe.tsx` 与 `lynx.config.ts` 的 `a2uiProbe` entry 已删除。
