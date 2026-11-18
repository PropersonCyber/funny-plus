import type { GuideDraft, GuideSection, GuideShareSnapshot } from '@/types/index.ts'
import { stripLocalPhotos } from './photos.ts'

/**
 * 把一份草稿压成可以公开的快照（F08 后半）。
 *
 * 这是「发布」与「草稿」之间唯一的转换点，隐私口径全部落在这里，别处不再重复过滤：
 * 1. 只保留 `picked[planRef] === true` 的条目 —— 没勾的是「用户没决定要不要公开」，
 *    不是「默认公开然后渲染时藏起来」。两者在数据上必须不同：前者压根不进快照。
 * 2. `showCost` 为 false 时不带 `perPerson`，字段直接不存在，而不是带个 0 或 null。
 * 3. 照片交给 `stripLocalPhotos` 剥掉 local / dataUri —— 与云端草稿副本同一套口径，
 *    避免「草稿存云端时剥了、发布时忘了剥」这种两套标准。
 * 4. 不携带 id / tripId / picked：访客不需要，泄露了也没有用处，还会让这份快照
 *    在将来某天被拿去反查草稿。
 *
 * 某一天下所有条目都没勾时，这一天整天不进快照 —— 留一个空标题的 Day N 比不显示更糟。
 */
export function buildShareSnapshot(
  draft: GuideDraft,
  perPerson: number | undefined,
  now = new Date()
): GuideShareSnapshot {
  const sections: GuideSection[] = draft.sections
    .map((s) => ({
      dayIndex: s.dayIndex,
      items: s.items.filter((it) => draft.picked[it.planRef] === true)
    }))
    .filter((s) => s.items.length > 0)

  const snapshot: GuideShareSnapshot = {
    title: draft.title,
    summary: draft.summary,
    photos: draft.photos,
    showCost: draft.showCost,
    sections,
    publishedAt: now.toISOString()
  }

  // 费用只在用户打开开关、且确实带了一个有限数时出现。
  // 0 是合法费用（免费景点一日游），所以判的是 Number.isFinite 而不是真值。
  if (draft.showCost && typeof perPerson === 'number' && Number.isFinite(perPerson)) {
    snapshot.perPerson = perPerson
  }

  return stripLocalPhotos(snapshot)
}
