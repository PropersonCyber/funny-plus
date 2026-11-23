# B1 回忆草稿生成（N8）

## 背景

`docs/spec-ai-native-gap.md` §5 N8：结束旅行只写 `endedAt` 并建一份空回忆记录
（`lynx/src/App/useTrips.ts:257`，`overview: ''`），用户面对的是整页空白，没有任何「起点」。

`docs/ai-native-mvp.md:209`（9.7）要求：结束旅行后按时间或地点整理**可编辑草稿**，
区分原计划 / 用户确认过的到访 / 其他记录；数据缺失时留空或邀请补充，**不代写未发生的经历**。

## Requirements

- MUST 在用户主动结束旅行时，按天整理出一份草稿文本，逐条只使用用户自己写下的内容。
- MUST 区分三种状态：`visited === 'yes'` 标为去了、`'no'` 标为没去、`'unknown'` 归入「还没记」。
- MUST NOT 生成任何用户没写过的感受文案；`text` 为空就不带正文。
- MUST NOT 把 `visited === 'unknown'` 的地点写成实际经历。
- MUST NOT 覆盖用户已经写下的 `overview`；已有 `overview` 时不生成草稿。
- MUST NOT 在无可整理内容时强行生成（无方案 / 无任何地点记录 → 返回空，交由页面邀请补充）。
- 草稿 MUST 可采纳为 `overview`，也可整份丢弃；丢弃后再次结束旅行不重新生成同一份。
- 草稿独立存放在 `TripMemory.draft`，不直接写进 `overview`：`overview` 会作为攻略概述
  带出去（`lynx/src/App/useGuides.ts:63`），草稿默认不该变成用户要公开的那段话。

## Acceptance Criteria

- [ ] **WHEN** 一趟旅行有 3 个 `visited === 'yes'`、2 个 `visited === 'unknown'` 且后者写了文字
      **THEN** 3 个带「去了」与各自原文，2 个标「未确认到访」并带原文，一个都不写成亲历
- [ ] **WHEN** 某地点无任何记录（无 visited、无 text、无照片）
      **THEN** 草稿正文不为它生成任何句子；仅在末尾「还没记」里列出名字
- [ ] **WHEN** 用户已写过 `overview` 后结束旅行
      **THEN** 不生成草稿，`overview` 一字不动
- [ ] **WHEN** 用户点「用作回顾」
      **THEN** `overview` 变为草稿内容，草稿清空
- [ ] **WHEN** 用户点「删掉」
      **THEN** 草稿清空，`overview` 不变
- [ ] **WHEN** 杀掉进程重进
      **THEN** 未处理的草稿仍在（`loadMemory` 不认识它就会被静默丢弃，属回归）

## Out of scope

- 不调用模型生成文字（本期只做确定性整理；`docs/ai-native-mvp.md` 未要求模型）。
- 不动回忆页布局与视觉（`docs/ai-native-plan.md:26`）。
- 不新增数据库列：`trip_memories.payload` 是 jsonb 透传（`server/src/db/schema.ts:493`），
  服务端零改动。
