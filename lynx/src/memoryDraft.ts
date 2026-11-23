/**
 * 回忆草稿（N8）。
 *
 * 实现已移到 `shared/engine/memoryDraft.ts`：服务端要拿同一份确定性文本
 * 作为模型叙述的兜底与基线，两边各留一份必然分叉 —— 那种分叉只会在
 * 「AI 不可用时草稿内容跟以前不一样」时暴露，而那时没人会想到是复制造成的。
 *
 * 这里只做转发，保持既有 import 路径不变。
 */
export { buildMemoryDraft, draftFor } from '../../shared/engine/memoryDraft.js';
