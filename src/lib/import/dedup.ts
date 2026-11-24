/**
 * Phase 30.5 — 导入去重工具
 *
 * 本地计算，无需 AI。用于导入流水线的三类去重：
 * 1. 世界观字段句子级去重
 * 2. 角色同名检测
 * 3. 大纲标题/内容相似度检测
 */

// ── 1. 世界观句子级去重 ──────────────────────────────────────

/**
 * 将文本拆分为句子（按中文句号、问号、感叹号、分号、换行）
 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？；\n]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4) // 过滤太短的片段
}

/**
 * 计算两个句子的字符级 Jaccard 相似度
 * 使用 2-gram（bigram）而非单字，提高区分度
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const getBigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2))
    }
    return set
  }

  const setA = getBigrams(a)
  const setB = getBigrams(b)
  let intersection = 0
  for (const g of setA) {
    if (setB.has(g)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 去重追加世界观文本：过滤掉与已有内容高度相似的句子
 *
 * @param existing 已有的字段内容
 * @param incoming 新块解析出的内容
 * @param threshold 相似度阈值（默认 0.7，超过则认为重复）
 * @returns 去重后的追加文本（可能为空字符串）
 */
export function deduplicateWorldviewText(
  existing: string,
  incoming: string,
  threshold = 0.7,
): string {
  if (!existing || !incoming) return incoming || ''

  const existingSentences = splitSentences(existing)
  const incomingSentences = splitSentences(incoming)

  const unique: string[] = []

  for (const inc of incomingSentences) {
    let isDuplicate = false
    for (const ext of existingSentences) {
      if (bigramSimilarity(inc, ext) >= threshold) {
        isDuplicate = true
        break
      }
    }
    if (!isDuplicate) {
      unique.push(inc)
    }
  }

  // 如果全部去重后为空，不追加
  if (unique.length === 0) return ''

  // 用中文句号重新连接
  return unique.join('。') + '。'
}

// ── 2. 角色同名检测 ──────────────────────────────────────────

export interface CharacterDedupResult {
  /** 是否已存在同名角色 */
  isDuplicate: boolean
  /** 已存在的角色 ID（如果重复） */
  existingId?: number
  /** 匹配到的已有角色名 */
  matchedName?: string
}

/**
 * 检查角色是否已存在（精确匹配 + 去空格匹配）
 */
export function checkCharacterDuplicate(
  name: string,
  existingNames: Map<string, number>,
): CharacterDedupResult {
  const trimmed = name.trim()
  // 精确匹配
  if (existingNames.has(trimmed)) {
    return { isDuplicate: true, existingId: existingNames.get(trimmed)!, matchedName: trimmed }
  }
  // 去空格/标点匹配
  const normalized = trimmed.replace(/[\s·・\-—_]+/g, '')
  for (const [eName, eId] of existingNames) {
    const eNorm = eName.replace(/[\s·・\-—_]+/g, '')
    if (normalized === eNorm) {
      return { isDuplicate: true, existingId: eId, matchedName: eName }
    }
  }
  return { isDuplicate: false }
}

/**
 * 合并角色字段：将新内容追加到已有字段（避免丢信息）
 */
export function mergeCharacterFields(
  existing: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const result = { ...existing }
  for (const [key, val] of Object.entries(incoming)) {
    if (!val || !val.trim()) continue
    const cur = result[key] || ''
    if (!cur) {
      result[key] = val.trim()
    } else if (!cur.includes(val.trim())) {
      // 避免完全重复的内容
      result[key] = `${cur}\n\n${val.trim()}`
    }
  }
  return result
}

// ── 3. 大纲标题去重 ──────────────────────────────────────────

export interface OutlineDedupResult {
  /** 是否已存在相似的大纲节点 */
  isDuplicate: boolean
  /** 匹配到的已有节点 ID */
  existingId?: number
  /** 相似度分数 */
  similarity?: number
}

/**
 * 检查大纲节点是否已存在（标题精确匹配 或 标题+摘要高相似度）
 */
export function checkOutlineDuplicate(
  title: string,
  summary: string,
  existingNodes: Array<{ id?: number; title: string; summary: string }>,
  threshold = 0.8,
): OutlineDedupResult {
  const t = title.trim()

  for (const node of existingNodes) {
    // 标题精确匹配
    if (node.title.trim() === t) {
      return { isDuplicate: true, existingId: node.id, similarity: 1 }
    }
    // 标题高相似度
    const titleSim = bigramSimilarity(node.title, t)
    if (titleSim >= threshold) {
      return { isDuplicate: true, existingId: node.id, similarity: titleSim }
    }
    // 标题+摘要组合相似度
    if (summary && node.summary) {
      const combined = `${t} ${summary}`
      const existCombined = `${node.title} ${node.summary}`
      const sim = bigramSimilarity(combined, existCombined)
      if (sim >= threshold) {
        return { isDuplicate: true, existingId: node.id, similarity: sim }
      }
    }
  }

  return { isDuplicate: false }
}

// ── 4. 同名冲突只读汇总（032-L1-d：确认前提示，不改写入语义） ─────────────

export interface SameNameConflictInputV1 {
  /** 目标世界内已存在的角色（按 id + name 对齐，供 checkCharacterDuplicate） */
  existingCharacters?: ReadonlyArray<{ id?: number; name: string }>
  /** 目标作品/世界已存在的大纲节点（供 checkOutlineDuplicate） */
  existingOutlines?: ReadonlyArray<{ id?: number; title: string; summary: string }>
  /** 本次待导入的角色名（AI 解析候选） */
  incomingCharacters?: readonly string[]
  /** 本次待导入的大纲标题（AI 解析候选） */
  incomingOutlines?: readonly { title: string; summary: string }[]
}

/** 既有规则提示语（与 chunk-writer 行为一一对应，不新增口径） */
export const SAME_NAME_CONFLICT_RULES_V1 = Object.freeze({
  characterAppend: '同名角色将按目标世界的既有规则合并字段内容；异名角色不受影响、不会被删除。',
  outlineMerge: '同名大纲将按目标世界的既有规则挂到该节点；异名节点不受影响、不会被删除。',
  worldviewAppend: '同名字段的内容会按句子去重后追加到现有字段；不会覆盖原文。',
})

export interface SameNameConflictItemV1 {
  kind: 'character' | 'outline'
  incomingName: string
  existingId?: number
  existingName: string
  similarity?: number
  hint: string
}

/**
 * 纯检测：把"即将写入的条目名"与"目标世界已有条目"逐项对照，产出同名清单。
 *
 * 只做展示前的可见性判断，不做任何 DB/adopt/写入动作，也不改变
 * chunk-writer 既有的合并/追加语义。无同名时返回空数组（调用方据此不渲染区块）。
 */
export function detectSameNameConflictsV1(input: SameNameConflictInputV1): SameNameConflictItemV1[] {
  const items: SameNameConflictItemV1[] = []

  if (input.incomingCharacters?.length) {
    const existing = input.existingCharacters ?? []
    const byName = new Map<string, number>()
    for (const character of existing) {
      if (character.id == null || !character.name.trim()) continue
      byName.set(character.name.trim(), character.id)
    }
    for (const rawName of input.incomingCharacters) {
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      if (!name) continue
      const result = checkCharacterDuplicate(name, byName)
      if (result.isDuplicate && result.matchedName) {
        items.push({
          kind: 'character', incomingName: name,
          existingId: result.existingId, existingName: result.matchedName,
          hint: SAME_NAME_CONFLICT_RULES_V1.characterAppend,
        })
      }
    }
  }

  if (input.incomingOutlines?.length) {
    // checkOutlineDuplicate 只读，转成可变数组以满足其参数类型（不改检测语义）。
    const existing: Array<{ id?: number; title: string; summary: string }> = [...(input.existingOutlines ?? [])]
    for (const node of input.incomingOutlines) {
      const title = typeof node?.title === 'string' ? node.title.trim() : ''
      if (!title) continue
      const result = checkOutlineDuplicate(title, node.summary ?? '', existing)
      if (result.isDuplicate) {
        items.push({
          kind: 'outline', incomingName: title,
          existingId: result.existingId, existingName: title,
          similarity: result.similarity,
          hint: SAME_NAME_CONFLICT_RULES_V1.outlineMerge,
        })
      }
    }
  }

  return items
}
