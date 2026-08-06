/**
 * NS-5 · 叙事感知混合检索 — 检索块数据模型。
 *
 * 设计权威 §22.8 NS-5 / 桌面方案。要点：
 * - retrievalChunk 是【可重建派生缓存】（从章节正文切块而来），故 exportable:false、不进备份，
 *   导入后由 chapter 正文重建——避免把大体积向量塞进 JSON 备份。
 * - 双通道召回：keywords（实体/关键词，纯浏览器、无需 embedding API）；embedding（语义向量，可选，
 *   不可用时优雅降级到纯关键词）。
 * - 失效：sourceTextHash 随章节正文变化 → 该章的块过期重建；embeddingModel 变 → 向量需重算。
 */

export interface RetrievalChunk {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null
  /** 来源章节（删章 / 改章 → 该章的块重建或清除） */
  sourceChapterId: number
  /** 块在本章内的序号（按时间/正文顺序） */
  chunkIndex: number
  /** 块正文（切块后的片段） */
  text: string
  /** 关键词/实体（关键词通道召回用，无需 embedding） */
  keywords: string[]
  /** 语义向量（embedding 通道，可选；不可用时为空，走纯关键词降级） */
  embedding?: number[] | null
  /** 产出向量的模型标识（换模型 → 向量需重算） */
  embeddingModel?: string | null
  /** 源正文标准化 hash（正文改 → 块过期重建） */
  sourceTextHash: string
  createdAt: number
}

/** 余弦相似度（embedding 通道暴力检索用；向量为空时返回 0）。 */
export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
