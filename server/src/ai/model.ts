import { createOpenAI } from '@ai-sdk/openai'
import { aiGateway } from '../env.ts'

/**
 * 模型客户端。
 *
 * 用 `.chat()` 而不是默认的 `provider(modelId)`：SDK 的默认入口打的是 OpenAI 的
 * responses API，而 ops-ai-gateway 只声明支持 `openai` 这条 chat completions 通道，
 * 走错通道会拿到 404 或字段不匹配，且报错信息不会告诉你是通道选错了。
 *
 * baseURL 必须自己拼 `/v1`：gateway 的根路径没有该前缀，而 SDK 只做路径拼接不补前缀。
 */
const provider = createOpenAI({
  baseURL: aiGateway.baseUrl,
  apiKey: aiGateway.apiKey,
})

export function chatModel() {
  return provider.chat(aiGateway.model)
}

export const aiConfigured = aiGateway.configured
