/**
 * Phase 32.3 — 世界规则清单生成器（World Rules Manifest）
 *
 * 将用户填写的「真实与幻想」数据（WorldRulesProfile）转成结构化文本，
 * 注入所有 AI prompt 的 system / context 层。
 *
 * 设计原则：
 * - 只输出非空节点，不浪费 token
 * - 史实锚点（historicalAnchors）和架空改造（fictionalAdaptations）分区显示
 * - 冲突优先级作为 AI 裁决依据
 * - 历史时间线事件（isHistorical=true）自动注入为不可违反的锚点
 * - 历史关键词按分类注入为时代质感约束
 * - 不设硬性 token 上限，仅提供估算供 UI 展示
 */

import type { WorldRulesProfile, WorldRuleEntry, ConflictPriority } from '../types/world-rules'
import { WORLD_RULE_TREE, CONFLICT_PRIORITY_LABELS } from '../types/world-rules'
import type { HistoricalTimelineEvent, HistoricalKeyword, HistoricalKeywordCategory } from '../types/history'
import { KEYWORD_CATEGORY_LABELS } from '../types/history'

// ── 节点标签查找 ──────────────────────────────────────────────

/** 从预定义树 + 自定义节点中查找节点标签 */
function resolveLabel(
  nodeId: string,
  customNodes: { id: string; label: string; icon?: string }[],
): string {
  // 先查预定义树
  for (const l1 of WORLD_RULE_TREE) {
    if (l1.id === nodeId) return `${l1.icon} ${l1.label}`
    if (l1.children) {
      for (const l2 of l1.children) {
        if (l2.id === nodeId) return `${l2.icon} ${l2.label}`
      }
    }
  }
  // 再查自定义节点
  const custom = customNodes.find(n => n.id === nodeId)
  if (custom) return `${custom.icon || '🔖'} ${custom.label}`
  return nodeId
}

/** 获取节点所属的 L1 大类标签（用于分组输出） */
function resolveL1Group(
  nodeId: string,
  customNodes: { id: string; parentId: string | null; label: string; icon?: string }[],
): string {
  // 预定义 L1
  for (const l1 of WORLD_RULE_TREE) {
    if (l1.id === nodeId) return `${l1.icon} ${l1.label}`
    if (l1.children?.some(l2 => l2.id === nodeId)) {
      return `${l1.icon} ${l1.label}`
    }
  }
  // 自定义节点
  const custom = customNodes.find(n => n.id === nodeId)
  if (custom) {
    if (!custom.parentId) return `${custom.icon || '🔖'} ${custom.label}`
    // 子节点 → 找父节点
    return resolveL1Group(custom.parentId, customNodes)
  }
  return '其他'
}

// ── 优先级文本 ──────────────────────────────────────────────────

function priorityDirective(p: ConflictPriority): string {
  switch (p) {
    case 'historical': return '⚠️ 当架空设定与史实冲突时，以史实为准'
    case 'fictional': return '⚠️ 当架空设定与史实冲突时，以架空设定为准'
    case 'balanced': return '当架空设定与史实冲突时，请智能权衡，尽量保持两者一致性'
  }
}

// ── 核心：生成清单文本 ──────────────────────────────────────────

export interface ManifestOptions {
  /** 历史时间线事件（可选，仅 isHistorical=true 的会成为锚点） */
  timelineEvents?: HistoricalTimelineEvent[]
  /** 历史关键词（可选） */
  keywords?: HistoricalKeyword[]
}

/**
 * 从 WorldRulesProfile 生成 AI 可消费的结构化清单文本。
 * 返回空字符串 = 用户未填写任何世界规则。
 */
export function buildWorldRulesManifest(
  profile: WorldRulesProfile | null,
  options: ManifestOptions = {},
): string {
  if (!profile) return ''

  const { entries, customNodes, globalNote } = profile
  const { timelineEvents, keywords } = options

  const sections: string[] = []

  // ── 1. 按 L1 大类分组输出用户设定 ────────────────────────────

  const filledEntries = Object.entries(entries).filter(
    ([, e]) => e.historicalAnchors.trim() || e.fictionalAdaptations.trim()
  )

  if (filledEntries.length > 0) {
    // 按所属 L1 大类分组
    const groups = new Map<string, { nodeId: string; label: string; entry: WorldRuleEntry }[]>()

    for (const [nodeId, entry] of filledEntries) {
      const groupKey = resolveL1Group(nodeId, customNodes)
      const list = groups.get(groupKey) || []
      list.push({
        nodeId,
        label: resolveLabel(nodeId, customNodes),
        entry,
      })
      groups.set(groupKey, list)
    }

    sections.push('【世界规则 — 真实与幻想】')
    sections.push('以下是本作品的世界观真实性设定，AI 在生成内容时必须严格遵守。')
    sections.push('')

    for (const [groupLabel, items] of groups) {
      const groupLines: string[] = [`▸ ${groupLabel}`]

      for (const { label, entry } of items) {
        groupLines.push(`  ${label}`)

        if (entry.historicalAnchors.trim()) {
          groupLines.push(`    📜 取自真实：${entry.historicalAnchors.trim()}`)
        }
        if (entry.fictionalAdaptations.trim()) {
          groupLines.push(`    ✨ 架空改造：${entry.fictionalAdaptations.trim()}`)
        }
        if (entry.priority !== 'balanced') {
          groupLines.push(`    ${priorityDirective(entry.priority)}`)
        }
      }

      sections.push(groupLines.join('\n'))
    }
  }

  // ── 2. 历史时间线锚点（isHistorical=true 的事件） ─────────────

  const anchorEvents = timelineEvents?.filter(e => e.isHistorical) || []
  if (anchorEvents.length > 0) {
    const eventLines: string[] = [
      '【历史锚点 — 以下真实事件不可违反】',
    ]
    // 按年份排序
    const sorted = [...anchorEvents].sort((a, b) => a.year - b.year)
    for (const e of sorted) {
      const desc = e.description ? `——${e.description.slice(0, 120)}` : ''
      eventLines.push(`  ⚓ ${e.date}：${e.title}${desc}`)
    }
    sections.push(eventLines.join('\n'))
  }

  // ── 3. 虚构事件参考（isHistorical=false） ─────────────────────

  const fictionalEvents = timelineEvents?.filter(e => !e.isHistorical) || []
  if (fictionalEvents.length > 0) {
    const eventLines: string[] = [
      '【作者规划事件 — 以下虚构事件为作者设计，可灵活使用】',
    ]
    const sorted = [...fictionalEvents].sort((a, b) => a.year - b.year)
    for (const e of sorted) {
      const desc = e.description ? `——${e.description.slice(0, 120)}` : ''
      eventLines.push(`  ✨ ${e.date}：${e.title}${desc}`)
    }
    sections.push(eventLines.join('\n'))
  }

  // ── 4. 历史关键词（时代质感约束） ─────────────────────────────

  if (keywords && keywords.length > 0) {
    const byCategory = new Map<HistoricalKeywordCategory, HistoricalKeyword[]>()
    for (const kw of keywords) {
      const list = byCategory.get(kw.category) || []
      list.push(kw)
      byCategory.set(kw.category, list)
    }

    const kwLines: string[] = [
      '【时代关键词 — 创作中应使用这些时代元素，避免超越时代的物品/制度】',
    ]
    for (const [cat, kws] of byCategory) {
      const label = KEYWORD_CATEGORY_LABELS[cat] || cat
      const items = kws.map(k => {
        const desc = k.description ? `（${k.description.slice(0, 50)}）` : ''
        return `${k.keyword}${desc}`
      }).join('、')
      kwLines.push(`  · ${label}：${items}`)
    }
    sections.push(kwLines.join('\n'))
  }

  // ── 5. 全局补充说明 ──────────────────────────────────────────

  if (globalNote?.trim()) {
    sections.push(`【全局补充说明】\n${globalNote.trim()}`)
  }

  // ── 6. 尾部统一冲突指引 ──────────────────────────────────────

  if (filledEntries.length > 0) {
    // 统计所有节点的优先级分布
    const priorities = filledEntries.map(([, e]) => e.priority)
    const hasHistorical = priorities.includes('historical')
    const hasFictional = priorities.includes('fictional')

    if (hasHistorical || hasFictional) {
      sections.push(
        '【冲突裁决原则】\n' +
        '各维度设定了不同的冲突优先级（' +
        `${CONFLICT_PRIORITY_LABELS.historical} / ${CONFLICT_PRIORITY_LABELS.balanced} / ${CONFLICT_PRIORITY_LABELS.fictional}` +
        '），请按各维度的标注裁决。' +
        '未标注的维度默认「均衡」——尽量保持真实与幻想的一致性。'
      )
    }
  }

  // 没有任何内容则返回空
  if (sections.length === 0) return ''

  sections.push('【世界规则结束】')
  return sections.join('\n\n')
}

// ── Token 估算（供 UI 展示） ─────────────────────────────────────

/**
 * 估算清单文本的 token 数（中文约 0.6 token/字符）
 */
export function estimateManifestTokens(manifestText: string): number {
  if (!manifestText) return 0
  // 中文：约 1.5 字符/token → 0.67 token/字符
  // 英文/数字：约 4 字符/token → 0.25 token/字符
  // 混合文本取 0.6 作为中文为主的估算
  return Math.ceil(manifestText.length * 0.6)
}

// ── 便捷：从 DB 读取并生成完整清单 ────────────────────────────

import { db } from '../db/schema'

/**
 * 一站式：从 DB 读取项目的世界规则 + 时间线 + 关键词，生成完整清单。
 * 用于 prompt 注入时调用。
 */
async function resolveDefaultWorldRulesProfile(projectId: number): Promise<WorldRulesProfile | null> {
  const profiles = await db.worldRulesProfiles.where('projectId').equals(projectId).toArray()
  const nullProfile = profiles.find(p => (p.worldGroupId ?? null) === null)
  if (nullProfile) return nullProfile
  const primary = await db.worldGroups.where('projectId').equals(projectId).toArray()
    .then(groups => groups.find(g => g.type === 'primary') ?? groups.sort((a, b) => a.order - b.order)[0])
  if (!primary?.id) return null
  return profiles.find(p => p.worldGroupId === primary.id) ?? null
}

export async function buildWorldRulesContext(
  projectId: number,
  worldGroupId?: number | null,
): Promise<string> {
  // 1. 读世界规则 profile
  const profile = worldGroupId !== undefined
    ? (await db.worldRulesProfiles.where('projectId').equals(projectId).toArray())
      .find(p => (p.worldGroupId ?? null) === (worldGroupId ?? null)) ?? null
    : await resolveDefaultWorldRulesProfile(projectId)

  if (!profile) return ''
  const effectiveWorldGroupId = worldGroupId !== undefined
    ? (worldGroupId ?? null)
    : (profile.worldGroupId ?? null)
  const shouldFilterWorld = worldGroupId !== undefined || effectiveWorldGroupId != null

  // 2. 读历史时间线事件
  const timelineEvents = (await db.historicalTimelineEvents
    .where('projectId').equals(projectId)
    .sortBy('year'))
    .filter(e => !shouldFilterWorld || (e.worldGroupId ?? null) === effectiveWorldGroupId)

  // 3. 读历史关键词
  const keywords = (await db.historicalKeywords
    .where('projectId').equals(projectId)
    .toArray())
    .filter(k => !shouldFilterWorld || (k.worldGroupId ?? null) === effectiveWorldGroupId)

  return buildWorldRulesManifest(profile, { timelineEvents, keywords })
}
