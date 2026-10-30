import type { FactFeedbackSummary, FeedbackVerdict } from '@/types'
import { readError } from './http'
import { DEMO_CLIENT_ID, demoMode } from '@/lib/demo'

// 匿名去重用的设备标识，只存在本机；丢了就换一个，不影响已有反馈
const KEY = 'funny-plus.client-id.v1'

export function clientId(): string {
  // 演示模式下固定用测试账号，才能看到「你已反馈」这类状态
  if (demoMode()) return DEMO_CLIENT_ID
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return ''
  }
}

export async function fetchFeedback(): Promise<FactFeedbackSummary[]> {
  const id = clientId()
  const res = await fetch(`/api/facts/feedback${id ? `?clientId=${encodeURIComponent(id)}` : ''}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { items: FactFeedbackSummary[] }
  return body.items
}

export async function submitFeedback(
  factId: string,
  verdict: FeedbackVerdict,
  note: string
): Promise<FactFeedbackSummary> {
  const id = clientId()
  if (!id) throw new Error('浏览器禁用了本地存储，无法提交反馈')
  const res = await fetch('/api/facts/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factId, verdict, note, clientId: id })
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { item: FactFeedbackSummary }
  return body.item
}
