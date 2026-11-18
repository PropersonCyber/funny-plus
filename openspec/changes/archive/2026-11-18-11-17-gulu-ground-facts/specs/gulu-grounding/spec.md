# gulu-grounding

咕噜解释事实、处理硬冲突，并把对话留在本机。

## ADDED Requirements

### Requirement: 事实只来自工具

系统 MUST 用引擎数据回答营业时间、票价、避坑、费用依据和班次。票价未核实 MUST 保持空值，MUST NOT 当成免费。过期避坑 MUST NOT 进入有效列表，只返回条数。

#### Scenario: 票价未核实

- **WHEN** 地点票价为 null
- **THEN** 工具返回的 ticket 为 null，且 ticketStatus 为「未核实」

#### Scenario: 过期避坑

- **WHEN** 同一城市同时有未过期和已过期的避坑
- **THEN** fresh 只含未过期条目，expiredCount 为过期条数

### Requirement: 硬冲突最多再试一次

系统 MUST 在生成方案时附上硬冲突和 hint。第一次有冲突时 hint MUST 允许再生成一版。第二次仍有冲突时 hint MUST 要求停止，且 MUST NOT 改写已保存行程。

#### Scenario: 第二次仍冲突

- **WHEN** errorCount 大于 0 且 attempt 大于等于 2
- **THEN** hint 要求停止再生成，并向用户说明排不下

### Requirement: 对话按行程留在本机

系统 MUST 按行程 id 保存对话文字。没有行程时记在草稿。生成新行程后，草稿 MUST 跟到新行程并清除。已有行程上再生成另一份时，旧行程的对话 MUST 保留。

#### Scenario: 草稿跟到新行程

- **WHEN** 用户在没有行程时说完需求，并选定方案生成新行程
- **THEN** 新行程能读到这段对话，草稿被清掉

#### Scenario: 旧行程对话还在

- **WHEN** 用户已有行程 A 的对话，又生成行程 B
- **THEN** 行程 A 和行程 B 都能读到当时的文字
