export type StoredTurn = { role: 'user' | 'assistant'; text: string }

export type StoredSlots = {
  destination?: string
  dayCount?: number
  party?: number
  budgetLevel?: 'low' | 'mid' | 'high' | 'flexible'
  preferences?: string[]
  transport?: 'public' | 'car' | 'charter' | 'compare'
  notes?: string
  hours?: number
  startMin?: number
  returnBy?: number
  mustVisit?: string[]
}

export type StoredLog = { turns: StoredTurn[]; slots: StoredSlots }

export type ChatBook = Record<string, StoredLog>

export const CHAT_STORAGE_KEY = 'funny-plus.chat.v1'

const MAX_TURNS = 40

export function chatBucket(tripId: string): string {
  const id = tripId.trim()
  return id || 'draft'
}

function isSlots(v: unknown): v is StoredSlots {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function parseChatBook(raw: string | null): ChatBook {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, StoredLog>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const book: ChatBook = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || !Array.isArray(value.turns)) continue
      const turns = value.turns
        .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
        .slice(-MAX_TURNS)
        .map((t) => ({ role: t.role, text: t.text }))
      book[key] = { turns, slots: isSlots(value.slots) ? value.slots : {} }
    }
    return book
  } catch {
    return {}
  }
}

export function readLog(book: ChatBook, tripId: string): StoredLog {
  return book[chatBucket(tripId)] ?? { turns: [], slots: {} }
}

export function writeLog(book: ChatBook, tripId: string, log: StoredLog): ChatBook {
  return {
    ...book,
    [chatBucket(tripId)]: { turns: log.turns.slice(-MAX_TURNS), slots: log.slots }
  }
}

/** 新行程接过这次对话。没有旧行程 id 时清掉草稿，已有行程的记录留在原处。 */
export function followTrip(book: ChatBook, fromId: string, toId: string): ChatBook {
  if (!toId.trim() || chatBucket(fromId) === chatBucket(toId)) return book
  const from = book[chatBucket(fromId)]
  if (!from) return book
  const next: ChatBook = {
    ...book,
    [chatBucket(toId)]: {
      turns: from.turns.map((t) => ({ ...t })),
      slots: { ...from.slots }
    }
  }
  if (!fromId.trim()) delete next.draft
  return next
}
