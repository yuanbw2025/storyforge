import type { Worldview, StoryCore, PowerSystem, Character } from '../types'
import { DIMENSION_LABELS, ANALYSIS_DIMENSIONS } from '../types/reference'
import { loadContextMemo } from '../export/context-snapshot'
import { db } from '../db/schema'

/** 获取已缓存的上下文快照（如果有） */
export function getContextMemo(projectId: number): string {
  const memo = loadContextMemo(projectId)
  if (!memo) return ''
  return `【上下文快照 — 此前故事状态】\n${memo}\n【快照结束】`
}

/** 构建世界观上下文摘要 */
export function buildWorldContext(wv: Worldview | null, sc: StoryCore | null, ps: PowerSystem | null): string {
  if (!wv && !sc && !ps) return ''
  const parts: string[] = []

  if (wv?.summary) {
    parts.push(`【世界观摘要】\n${wv.summary}`)
  } else if (wv) {
    const dims = [
      wv.geography && `地理：${wv.geography.slice(0, 200)}`,
      wv.society && `社会：${wv.society.slice(0, 200)}`,
      wv.rules && `规则：${wv.rules.slice(0, 200)}`,
    ].filter(Boolean)
    if (dims.length) parts.push(`【世界观】\n${dims.join('\n')}`)
  }

  if (sc) {
    const scParts = [
      sc.theme && `主题：${sc.theme}`,
      sc.centralConflict && `核心冲突：${sc.centralConflict}`,
      sc.plotPattern && `情节模式：${sc.plotPattern}`,
    ].filter(Boolean)
    if (scParts.length) parts.push(`【故事核心】\n${scParts.join('\n')}`)
  }

  if (ps?.name) {
    parts.push(`【力量体系】${ps.name}：${ps.description?.slice(0, 200) || ''}`)
  }

  return parts.join('\n\n')
}

/** 构建角色上下文 */
export function buildCharacterContext(characters: Character[]): string {
  if (!characters.length) return ''
  return characters.map(c =>
    `${c.name}（${getRoleLabel(c.role)}）：${c.shortDescription || ''}${c.personality ? `，性格：${c.personality.slice(0, 100)}` : ''}`
  ).join('\n')
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    protagonist: '主角', antagonist: '反派',
    supporting: '配角', minor: '次要',
  }
  return map[role] || role
}

/**
 * 构建"引用手法"上下文 —— 从已分析的参考作品中提取方法论注入 AI prompt。
 * 将每个维度的分析结论合并、去重、精简，形成可操作的创作指导。
 */
export async function buildRefAnalysisContext(refIds: number[]): Promise<string> {
  if (!refIds.length) return ''

  const parts: string[] = []

  for (const refId of refIds) {
    const ref = await db.references.get(refId)
    if (!ref || ref.analysisStatus !== 'done') continue

    const chunks = await db.referenceChunkAnalysis
      .where('referenceId').equals(refId)
      .sortBy('chunkIndex')

    if (!chunks.length) continue

    // 按维度汇总：每个维度取各块的结论合并（截取精华）
    const dimSummaries: string[] = []
    for (const dim of ANALYSIS_DIMENSIONS) {
      const dimContents = chunks
        .map(c => c[dim])
        .filter((v): v is string => !!v && v !== '本块未涉及')
      if (!dimContents.length) continue

      // 每块取前 150 字，最多取 3 块，避免 prompt 过长
      const selected = dimContents.slice(0, 3).map(t => t.slice(0, 150))
      dimSummaries.push(`· ${DIMENSION_LABELS[dim]}：${selected.join('；')}`)
    }

    if (dimSummaries.length) {
      parts.push(`【参考手法 — ${ref.title}${ref.author ? `（${ref.author}）` : ''}】\n${dimSummaries.join('\n')}`)
    }
  }

  if (!parts.length) return ''
  return `【引用手法 — 请参考以下大师创作方法论来指导写作】\n\n${parts.join('\n\n')}\n\n【引用手法结束 — 请灵活运用上述方法论，不要生搬硬套】`
}

/** 构建世界观各维度已有内容（用于 AI 生成时做参考） */
export function buildExistingWorldview(wv: Worldview | null): string {
  if (!wv) return ''
  const parts = [
    wv.geography && `地理环境：${wv.geography.slice(0, 300)}`,
    wv.history && `历史：${wv.history.slice(0, 300)}`,
    wv.society && `社会：${wv.society.slice(0, 300)}`,
    wv.culture && `文化：${wv.culture.slice(0, 300)}`,
    wv.economy && `经济：${wv.economy.slice(0, 300)}`,
    wv.rules && `规则：${wv.rules.slice(0, 300)}`,
  ].filter(Boolean)
  return parts.join('\n')
}
