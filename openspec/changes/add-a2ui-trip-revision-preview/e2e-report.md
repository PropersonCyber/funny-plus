# E2E / 等价验收报告: add-a2ui-trip-revision-preview

状态：**未执行**。本文件当前是骨架，随任务推进逐项填实测结果。不得填入未跑过的结论。

## 验收范围

对齐 `docs/spec-a2ui-trip-revision.md` §7 的 AC-01 ~ AC-09（AC-04 拆 a / b），以及本 change 的
`specs/a2ui-trip-revision/spec.md` 全部 Scenario。

## 分层验证计划

| 层 | 覆盖 | 手段 | 对应任务 |
| --- | --- | --- | --- |
| L1 契约 | `RevisePreview` → A2UI v1.0 消息转换、动作白名单 | rstest 纯函数用例（TDD） | 3.1 ~ 3.3 |
| L2 行为 | previewId 路由、防重、过期判定、状态转换 | rstest 纯函数用例（TDD） | 4.1 ~ 4.4 |
| L3 联调 | 流式 / 非流式双通道、引擎兜底、不重复请求 | 真实服务端对话 | 6.1 ~ 6.2 |
| L4 实机 | 三端渲染等价、降级回落、导航与过期路径 | Web / iOS / Android 手动运行 + 截图 | 1.3 / 5.3 / 6.3 |

渲染层降级按裁决走真机验收，本期不新建组件渲染测试基建。

## 命令与退出码

| 命令 | 退出码 | 时间 | 备注 |
| --- | --- | --- | --- |
| `npm --prefix lynx run typecheck` | 0 | ~1s | 加入探针后仍通过 |
| `npm --prefix lynx run build` | 0 | 4~8s | 含 `check:css`（710 个 class 对上） |
| `npm --prefix lynx run test` | 0 | 1.94s | 12 个文件 / 122 个用例全通过 |
| `npm --prefix lynx run test`（任务 2 后） | 0 | ~2s | 13 个文件 / 130 个用例（新增 8 个状态机用例） |
| `npm --prefix lynx run build`（任务 2 后） | 0 | 6~8s | 主 bundle 12034.0 kB（比接入前 +2.2 kB，来自 revisionState） |

## 三端实机证据

| 端 | 环境 | 场景 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| Web | rspeedy dev @ 3001 | 最小探针：固定消息 + 自定义 `ProbeCard` + 确认/先不改 | `browser-screenshot-1794896335901.jpg` | **通过**：卡片渲染正确，动作回传 `confirm`，载荷 `{"previewId":"probe-preview-1"}` |
| Web | 同上 + 真实服务端 | 真实对话 → 预览 → 确认 → 去行程页核对（任务 2.3） | `browser-screenshot-1794898080033.jpg` | **通过**：确认后仍停在对话页、显示「已写进行程」、确认按钮消失、出现「去行程页核对」；点它跳行程页，Day 2 只剩 1 个地点、时间 -70 分钟、人均没变，与预览一致 |
| Web | 同上，A2UI 卡片（任务 5） | 真实对话 → A2UI 卡片渲染 → 卡内确认 | `browser-screenshot-1794899791480.jpg` | **通过**：surface `surface-revision-rev-mwkcz59i-1` 渲染出原因 / 「宽窄巷子：换成「锦里古街」」/「时间没变 · 人均没变」/ 两个按钮；在 surface 内点确认后动作回传、状态转 applied、surface 卸载由旧卡片接管显示「已写进行程」 |
| iOS | Lynx 4.2.0（vendor pod） | 同上 | 待补 | 待跑 |
| Android | lynx 4.2.0 AAR | 同上 | 待补 | 待跑 |

## 依赖与体积记录

| 项 | 值 |
| --- | --- |
| `@lynx-js/genui` | 0.8.0（实测安装成功） |
| `@lynx-js/lynx-ui` | **未安装**。registry 标为 optional peer，不装也能构建成功（已实测）。只有内置 Modal / TextField / Slider / RadioGroup / ChoicePicker / DateTimeInput 才需要它 |
| `@lynx-js/react` | 0.126.2（未被顶版） |
| `@lynx-js/react-signals` | 0.0.7（随 genui 装上；peer 上限 0.129） |
| 嵌套副本 | `@lynx-js/react-rsbuild-plugin` 出现两份（仓内 0.20.4 + genui 自带 0.22.3），构建无冲突 |
| bundle 体积增量（实测） | 主 bundle 未变（web 12169.3 kB / lynx 12031.8 kB）；探针独立 entry 258.1 kB(web) / 273.4 kB(lynx)。业务接入后的真实增量待任务 5 测 |

## 已知限制

- a2ui 在 Lynx 4.2.0 上的渲染表现尚未实机验证，任务 1.3 是阻断点。
- `useErrorBoundary` 在 Lynx 渲染器中的真实捕获行为尚未验证。
- genui 与仓内 rsbuild 插件版本并存，需 build 验证无冲突。

## 验收结论

- 结论: 未执行
- 阻塞项: 实现尚未开始；分支门禁待用户确认；三端实机验收未跑；依赖未安装
- 归档建议: 不建议归档。需先完成任务 1 ~ 6，并把本节的结论、阻塞项与证据填成实测结果。