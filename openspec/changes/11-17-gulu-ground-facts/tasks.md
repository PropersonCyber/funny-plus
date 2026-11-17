# Tasks: 11-17-gulu-ground-facts

> 执行约束
> - 每个任务有验证点。
> - 纯函数先写测试再实现。
> - 不改页面样式。
> - 不做到达、账号、分享。

## 1. 解释工具

- [x] `shared/engine/aiGround.ts` 输出地点、避坑、预算、冲突 hint、线路
- 验证: `lynx` 里 `aiGround.test.ts`

## 2. 接到对话

- [x] `POST /api/ai/chat` 注册五个只读工具，`generatePlans` 带回 `checks` 和 `attempt`
- 验证: server `npm run typecheck`

## 3. 本机会话

- [x] `chatSession.ts` 按行程读写；选定方案后草稿跟到新行程
- [x] 助手页离开后再进能读到文字；`funny-plus.chat.v1` 进入 hydrate 的 key 列表
- 验证: `chatSession.test.ts`；lynx `npm run typecheck`

## 4. 文档

- [x] 架构说明 3.2 与本 change 的 proposal / spec 对齐
