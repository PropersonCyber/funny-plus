# B3 表单主链路走模型提案（N10）

## Goal

新增 POST /api/ai/plans，表单从本地 planFor 改为模型提案 + 引擎裁决；必须保住 AI_API_KEY 未配置时行为与今天完全一致，超时无损落回本地引擎。前置 G7 度量已完成。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
