/**
 * NS-5 · 层级叙事摘要树（章 → 卷 → 全书）。
 *
 * 这是可重建派生缓存，不是 Canon：来源仍是章节正文 / 已验证章节记忆 / 大纲。
 * 目的不是替代事实账本，而是在远距离检索前提供低成本的全局叙事骨架。
 */

export type NarrativeSummaryLevel = 'chapter' | 'volume' | 'book'

/**
 * §16.7 派生记忆四态：
 * - pending：缺少可用来源，等待生成/刷新；
 * - rebuilding：重建任务进行中；
 * - verified：来源 hash 与当前内容一致，可注入；
 * - stale：来源已变化或引用缺失，不得作为可信上下文注入。
 */
export type DerivedMemoryReviewStatus = 'pending' | 'rebuilding' | 'verified' | 'stale'

export interface NarrativeSummaryNode {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null
  level: NarrativeSummaryLevel

  /** chapter 级指向章节；volume 级指向卷节点；book 级为空。 */
  sourceChapterId?: number | null
  sourceOutlineNodeId?: number | null

  title: string
  summary: string
  keywords: string[]

  /** 来源版本指纹：chapter=正文 hash；volume/book=子摘要/节点内容聚合 hash。 */
  sourceHash: string
  status: DerivedMemoryReviewStatus
  generatedBy: 'system-rollup'

  createdAt: number
  updatedAt: number
}
