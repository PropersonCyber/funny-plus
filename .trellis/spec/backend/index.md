# Backend Development Guidelines

> 服务端（`server/`）的编码规格。与 `frontend/` 并列：本仓单仓全栈，两侧共用 `shared/`。

---

## Overview

这份目录记录**已经实现并验证过**的服务端契约，不是理想架构。每条规则都写清「为什么」——
只写「要这样做」的规范，下一个人（或下一次的 AI）会绕过去。

---

## Guidelines Index

| Spec | 覆盖 | 状态 |
|---|---|---|
| [Data Governance](./data-governance.md) | 字段级可信依据、用户补录 → 人工审核 → 发布、校验等级（error/warn）的判定边界、引擎缓存失效 | Active |

---

## 通用约定（跨 spec）

### 路由不直接摸 `process.env`

统一走 `server/src/env.ts`。唯一例外是 `ai/cost.ts` 的价目表（按模型名动态读）。

> **为什么**：同一组凭证在多个路由里要共用。散着读，早晚有一处读到不一样的默认值。

### 「没配」与「配错」必须分开

没配返回 `503 + code`，前端据此降级；配错把服务商原始错误码透出来。

> **为什么**：签名错、模板未审核、余额不足是完全不同的三件事。混成一句「服务失败」，
> 排查时得从头再猜一遍。

### 业务规则不进路由

纯计算与判定放 `shared/engine/`（可测、两端共用），持久化编排放 `server/src/data/`。
路由只做参数校验与序列化。

> **为什么**：路由 handler 没法单测，而 `shared/engine` 是纯函数。
> 规则写进 handler 就等于放弃回归。

### 序列化器只留一份

`Place` 只有 `routes/places.ts:toApi` 一个序列化器，`/api/content` 复用它。

> **为什么**：两份各改一半，界面拿到的内容和地点池就对不上，而且不会有任何报错。
