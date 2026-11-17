# E2E Report: 11-17-gulu-ground-facts

## 验证范围

- 依据: `specs/gulu-grounding/spec.md`、`proposal.md`
- 场景数: 4
- 执行时间: 2026-11-17 11:15

## 验证清单结论

- TDD / 静态检查: 通过
- 文档对照: 一致
- 浏览器验证: 未执行

## 与 QA spec / YApi 的显著差异

| 来源 | 预期 | 当前实现或其它 spec | 结论 |
|------|------|----------------------|------|
| 无 | 本次没有 QA spec 或 YApi | 工具加在已有 `POST /api/ai/chat` 上，没有新路径 | 无冲突 |

## 通过

- 票价 null 保持「未核实」：`lynx` `npm test`，`aiGround.test.ts`
- 过期避坑只计数：同上
- 第二次硬冲突的停止文案：`conflictHint(1, 2)`
- 草稿跟到新行程、旧行程对话保留：`chatSession.test.ts`
- lynx 与 server `npm run typecheck` 通过。测试 122 项通过

## 失败

- 无

## 阻塞项

- 没有用带 `AI_API_KEY` 的本机 API 在模拟器里问一句票价，也没有问「一天排太满」。工具返回形状有测试，模型会不会按提示词调用工具，这次没跑。

## 验收结论

- 结论: 通过
- 阻塞项: 真实模型对话未执行
- 归档建议: 需用户确认带债。代码场景已过；口头数字是否真的只来自工具，要等一次真实对话。
