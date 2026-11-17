# a2ui-trip-revision

咕噜对话中的行程修改预览卡片由 A2UI 渲染器渲染，业务依据仍是引擎产出的原始 `RevisePreview`，失败时退回现有卡片。

需求准源为 `docs/spec-a2ui-trip-revision.md`（FR-1 ~ FR-6、AC-01 ~ AC-09、§9 裁决）。本文件只写可观察行为。

## ADDED Requirements

### Requirement: 预览卡片内容与旧卡片等价

系统 MUST 用 A2UI 渲染器呈现预览卡片，且内容、格式、单位与正负号与旧卡片一致，不得由模型文本或 A2UI 补算数字。

#### Scenario: 完整预览

- **WHEN** 收到含地点、时间增减、人均费用增减与待确认事项的 `RevisePreview`
- **THEN** 卡片显示原因、逐条受影响项目、时间变化、人均费用变化、需重新确认事项
- **AND** 数值格式与旧卡片一致（`0` 显示「没变」，正值带 `+`，费用带 `¥`）

#### Scenario: 空列表与引擎兜底

- **WHEN** `impact.recheck` 为空数组
- **THEN** 不显示「要重新确认」行
- **AND** 当 `by === 'engine'` 时显示引擎兜底来源提示

#### Scenario: 三端可见

- **WHEN** 分别在 Web、iOS、Android 打开对话并生成同一份预览
- **THEN** 三端均渲染出等价卡片

### Requirement: 动作只携带 previewId

系统 MUST 只允许确认与取消两个动作，且动作载荷只携带 previewId；业务数据一律从本轮保存的原始预览取。

#### Scenario: 正常确认

- **WHEN** 用户点击确认
- **THEN** 客户端按 previewId 找到本轮原始 `RevisePreview`
- **AND** 用该预览的 plan 与 impact 调用现有应用入口

#### Scenario: 非法动作被忽略

- **WHEN** 收到未知动作名、未知 previewId，或目标预览已非 pending
- **THEN** 忽略该动作且不修改行程
- **AND** 记录可诊断信息

#### Scenario: 载荷不得覆盖业务数据

- **WHEN** 动作载荷中携带计划、费用或其他业务字段
- **THEN** 这些字段被丢弃，不影响应用结果

### Requirement: 一次确认只应用一次

系统 MUST 在同一预览生命周期内最多应用一次，并在处理开始时立即上锁。

#### Scenario: 连续点击

- **WHEN** 用户连续快速点击确认，或同一 previewId 的 Action 重复到达
- **THEN** 只应用一次，行程变更记录只新增一条

#### Scenario: 已应用后再次动作

- **WHEN** 预览已处于 applied
- **THEN** 后续确认动作被忽略

### Requirement: 确认后留在对话页

系统 MUST 在确认成功后保留对话页，卡片显示「已写进行程」，并提供「去行程页核对」入口。

#### Scenario: 确认成功

- **WHEN** 确认应用完成
- **THEN** 仍停留在对话页，不自动跳转
- **AND** 该卡片显示「已写进行程」且不再出现确认按钮

#### Scenario: 主动去核对

- **WHEN** 用户点击「去行程页核对」
- **THEN** 跳转到行程页
- **AND** 行程页呈现的方案与刚应用的预览一致

### Requirement: 取消移除卡片且不改行程

系统 MUST 在取消时丢弃该预览并移除卡片，不保留 cancelled 状态，不修改行程。

#### Scenario: 取消

- **WHEN** 用户点击「先不改」
- **THEN** 该轮预览卡片移除，不再出现确认入口
- **AND** 行程与方案一个字段都不变

### Requirement: 过期预览拒绝应用

系统 MUST 在生成预览时记录 `tripId + planIndex + plan 对象引用` 作为基准，确认前重新核对，不一致则拒绝并提示重新生成。

#### Scenario: 同页两份预览（真机可达）

- **WHEN** 同一对话页面内先后生成两份预览
- **AND** 用户确认了第一份，行程方案随之变化
- **AND** 用户再点第二份的确认
- **THEN** 拒绝应用，标记为过期
- **AND** 提示「行程已变化，请让咕噜重新提一次」

#### Scenario: 行程身份或方案序号变化（测试构造）

- **WHEN** 预览生成后 tripId 或 planIndex 发生变化
- **THEN** 确认被拒绝，不覆盖较新行程

#### Scenario: 同轮后一次预览覆盖前一次

- **WHEN** 同一轮内再次产生预览
- **THEN** 只保留最后一份
- **AND** 被覆盖的 previewId 立即失效，其后续动作被忽略

### Requirement: 失败降级到旧卡片且不绕过约束

系统 MUST 在依赖未启用、消息转换失败、协议或 Catalog 拒绝、渲染未就绪或运行时抛错时展示现有卡片，且旧卡片共用同一确认、取消、过期与防重入口。

#### Scenario: 转换失败

- **WHEN** 预览到 A2UI 消息的转换抛出异常
- **THEN** 展示旧卡片，内容与原始预览一致
- **AND** 不重复发起模型请求

#### Scenario: 未知组件或渲染抛错

- **WHEN** 协议引用了 Catalog 之外的组件，或渲染子树抛出异常
- **THEN** 回落旧卡片
- **AND** 确认与取消仍受防重与过期约束

#### Scenario: 降级不丢对话

- **WHEN** 发生降级
- **THEN** 已有对话内容不丢失，不重复应用变更

### Requirement: 双通道结果一致

系统 MUST 在流式与非流式两条工具结果路径上产出一致的预览、展示与动作，且不改变服务端响应。

#### Scenario: 同一预览两条通道

- **WHEN** 服务端分别以流式与非流式返回同一份预览
- **THEN** 卡片内容、确认与取消结果一致

#### Scenario: 不触发第二次模型请求

- **WHEN** A2UI 处理失败并降级
- **THEN** 不产生额外的模型请求