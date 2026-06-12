import type { Worldview, StoryCore, PowerSystem, Character, CreativeRules } from '../types'
import type { HistoricalKeyword, HistoricalKeywordCategory } from '../types/history'
import { KEYWORD_CATEGORY_LABELS } from '../types/history'
import { DIMENSION_LABELS, ANALYSIS_DIMENSIONS } from '../types/reference'
import { loadContextMemo } from '../export/context-snapshot'
import { db } from '../db/schema'

/** 获取已缓存的上下文快照（如果有） */
export function getContextMemo(projectId: number): string {
  const memo = loadContextMemo(projectId)
  if (!memo) return ''
  return `【上下文快照 — 此前故事状态】\n${memo}\n【快照结束】`
}

const POV_LABELS: Record<string, string> = {
  'first': '第一人称', 'third-limited': '第三人称限知', 'third-omniscient': '第三人称全知', 'second': '第二人称',
}

/**
 * 构建「创作规则」上下文（写作风格/视角/基调/禁忌/一致性/特殊要求）。
 * 此前创作规则面板填写的内容从不进入任何生成 prompt（仅 citedIds + 题材预设被用），
 * 导致作者填的写作规范喂不进 AI。此函数补齐该缺口。
 */
export function buildCreativeRulesContext(rules: CreativeRules | null): string {
  if (!rules) return ''
  const parts: string[] = []
  if (rules.writingStyle) parts.push(`写作风格：${rules.writingStyle.slice(0, 200)}`)
  const pov = rules.narrativePOV
  if (pov) parts.push(`叙事视角：${POV_LABELS[pov] || pov}`)
  const atmosphere = rules.atmosphere || rules.toneAndMood
  if (atmosphere) parts.push(`基调氛围：${atmosphere.slice(0, 150)}`)
  if (rules.specialRequirements) parts.push(`特殊要求：${rules.specialRequirements.slice(0, 200)}`)
  try {
    const proh: string[] = JSON.parse(rules.prohibitions || '[]')
    if (proh.length) parts.push(`禁止事项：${proh.join('；').slice(0, 200)}`)
  } catch { /* ignore */ }
  try {
    const cons: string[] = JSON.parse(rules.consistencyRules || '[]')
    if (cons.length) parts.push(`一致性规则：${cons.join('；').slice(0, 200)}`)
  } catch { /* ignore */ }
  if (!parts.length) return ''
  return `【创作规则】（务必遵守）\n${parts.join('\n')}`
}

// ── 单一事实源：世界观/故事核心/力量体系的字段格式化（单世界与多世界共用，杜绝漂移） ──

/** 格式化自然物产（珍禽异兽/灵药/矿石/其他）。Phase 35-b 迁到词条后将从此移除，改由 codex 注入。 */
function formatNaturalResources(nr: Worldview['naturalResources']): string {
  if (!nr) return ''
  const parts = [
    nr.rareCreatures && `珍禽异兽：${nr.rareCreatures.slice(0, 80)}`,
    nr.herbs && `灵药草药：${nr.herbs.slice(0, 80)}`,
    nr.minerals && `矿石矿料：${nr.minerals.slice(0, 80)}`,
    nr.others && `其他物产：${nr.others.slice(0, 60)}`,
  ].filter(Boolean)
  return parts.length ? `自然物产（${parts.join('；')}）` : ''
}

/**
 * 格式化世界观全部字段为【世界观】块。
 * 覆盖所有面板可填的 v3 字段；v3 全空时回退 v2 旧字段（极老项目）。
 * 注：naturalResources / itemDesign 现以自由文本注入；Phase 35-b 迁到词条后由 codex 承载，届时从此移除避免双轨。
 */
export function formatWorldviewBlock(wv: Worldview | null): string {
  if (!wv) return ''
  const d = wv.divineDesign
  const divine = d?.hasDivinity
    ? `神明设定：${[d.divineRank, d.divineNames, d.divineRules].filter(Boolean).join('；').slice(0, 200)}`
    : ''
  const v3 = [
    wv.summary && `摘要：${wv.summary.slice(0, 300)}`,
    wv.worldOrigin && `世界来源：${wv.worldOrigin.slice(0, 300)}`,
    wv.powerHierarchy && `力量体系：${wv.powerHierarchy.slice(0, 200)}`,
    divine,
    wv.worldStructure && `世界结构：${wv.worldStructure.slice(0, 150)}`,
    wv.worldDimensions && `世界尺寸：${wv.worldDimensions.slice(0, 100)}`,
    wv.continentLayout && `地貌分布：${wv.continentLayout.slice(0, 200)}`,
    wv.regionDimensions && `重镇/区域分布：${wv.regionDimensions.slice(0, 120)}`,
    wv.mountainsRivers && `山川河流：${wv.mountainsRivers.slice(0, 150)}`,
    wv.climateByRegion && `气候环境：${wv.climateByRegion.slice(0, 120)}`,
    wv.historyLine && `世界历史：${wv.historyLine.slice(0, 200)}`,
    wv.worldEvents && `世界大事记：${wv.worldEvents.slice(0, 200)}`,
    wv.naturalResourceOverview && `自然资源：${wv.naturalResourceOverview.slice(0, 150)}`,
    formatNaturalResources(wv.naturalResources),
    wv.races && `种族民族：${wv.races.slice(0, 150)}`,
    wv.factionLayout && `势力分布：${wv.factionLayout.slice(0, 200)}`,
    wv.politicsEconomyCulture && `政经文化：${wv.politicsEconomyCulture.slice(0, 150)}`,
    wv.internalConflicts && `矛盾冲突：${wv.internalConflicts.slice(0, 150)}`,
    wv.itemDesign && `道具设计：${wv.itemDesign.slice(0, 150)}`,
  ].filter(Boolean)
  if (v3.length) return `【世界观】\n${v3.join('\n')}`
  const v2 = [
    wv.geography && `地理：${wv.geography.slice(0, 200)}`,
    wv.society && `社会：${wv.society.slice(0, 200)}`,
    wv.rules && `规则：${wv.rules.slice(0, 200)}`,
  ].filter(Boolean)
  return v2.length ? `【世界观】\n${v2.join('\n')}` : ''
}

/** 格式化故事核心为【故事核心】块（全字段）。 */
export function formatStoryCoreBlock(sc: StoryCore | null): string {
  if (!sc) return ''
  const parts = [
    sc.logline && `一句话故事：${sc.logline}`,
    sc.theme && `主题：${sc.theme}`,
    sc.centralConflict && `核心冲突：${sc.centralConflict}`,
    sc.plotPattern && `情节模式：${sc.plotPattern}`,
    (sc.mainPlot || sc.storyLines) && `主线：${(sc.mainPlot || sc.storyLines).slice(0, 250)}`,
    sc.subPlots && `复线：${sc.subPlots.slice(0, 200)}`,
  ].filter(Boolean)
  return parts.length ? `【故事核心】\n${parts.join('\n')}` : ''
}

/** 格式化力量体系为【力量体系】块（含等级阶梯 + 规则）。 */
export function formatPowerSystemBlock(ps: PowerSystem | null): string {
  if (!ps?.name && !ps?.description && !ps?.levels) return ''
  const parts: string[] = []
  if (ps.name) parts.push(`${ps.name}：${ps.description?.slice(0, 200) || ''}`)
  else if (ps.description) parts.push(ps.description.slice(0, 200))
  try {
    const levels = JSON.parse(ps.levels || '[]')
    if (Array.isArray(levels) && levels.length) {
      const names = levels.map((l: { name?: string } | string) => typeof l === 'string' ? l : (l.name || '')).filter(Boolean)
      if (names.length) parts.push(`等级阶梯：${names.join(' → ').slice(0, 250)}`)
    }
  } catch { /* ignore */ }
  if (ps.rules) parts.push(`规则：${ps.rules.slice(0, 150)}`)
  return parts.length ? `【力量体系】\n${parts.join('\n')}` : ''
}

/** 构建世界观上下文摘要（单世界）。 */
export function buildWorldContext(wv: Worldview | null, sc: StoryCore | null, ps: PowerSystem | null): string {
  if (!wv && !sc && !ps) return ''
  const parts: string[] = []

  const wvBlock = formatWorldviewBlock(wv)
  if (wvBlock) parts.push(wvBlock)
  const scBlock = formatStoryCoreBlock(sc)
  if (scBlock) parts.push(scBlock)
  const psBlock = formatPowerSystemBlock(ps)
  if (psBlock) parts.push(psBlock)

  // Phase 23.2: 货币体系注入
  if (wv?.economy) {
    try {
      const parsed = JSON.parse(wv.economy)
      if (parsed.currencies?.length > 0) {
        const lines = ['【货币体系】']
        for (const c of parsed.currencies) {
          lines.push(`- ${c.symbol || '💰'} ${c.name}${c.description ? `（${c.description}）` : ''}`)
        }
        if (parsed.currencies.length >= 2) {
          const base = parsed.currencies.find((c: { id: string }) => c.id === parsed.baseCurrencyId)
          if (base) {
            lines.push('兑换：')
            for (const c of parsed.currencies) {
              if (c.id === parsed.baseCurrencyId) continue
              lines.push(`  1 ${base.name} = ${(c.value / base.value).toFixed(c.value >= base.value ? 0 : 2)} ${c.name}`)
            }
          }
        }
        if (parsed.note) lines.push(`备注：${parsed.note}`)
        lines.push('请严格使用以上货币，不要自创。')
        parts.push(lines.join('\n'))
      }
    } catch { /* not JSON currency format, skip */ }
  }

  return parts.join('\n\n')
}

/**
 * 构建角色上下文（分权重三层输出）
 *
 * - 核心角色（主角/反派）：完整信息（描述+性格+背景+动机+能力）
 * - 重要配角（supporting）：一句话描述+关系
 * - 其他（minor/npc/extra）：仅名字和定位
 */
export function buildCharacterContext(characters: Character[]): string {
  if (!characters.length) return ''

  const core = characters.filter(c => c.role === 'protagonist' || c.role === 'antagonist')
  const supporting = characters.filter(c => c.role === 'supporting')
  const others = characters.filter(c => c.role !== 'protagonist' && c.role !== 'antagonist' && c.role !== 'supporting')

  const parts: string[] = []

  if (core.length) {
    parts.push('【核心角色（完整信息）】')
    for (const c of core) {
      const details = [
        `${c.name}（${getRoleLabel(c.role)}）`,
        c.shortDescription ? `简介：${c.shortDescription}` : '',
        c.appearance ? `外貌：${c.appearance.slice(0, 150)}` : '',
        c.personality ? `性格：${c.personality.slice(0, 150)}` : '',
        c.background ? `背景：${c.background.slice(0, 200)}` : '',
        c.motivation ? `动机：${c.motivation.slice(0, 150)}` : '',
        c.abilities ? `能力：${c.abilities.slice(0, 150)}` : '',
        c.arc ? `成长弧线：${c.arc.slice(0, 150)}` : '',
      ].filter(Boolean).join('；')
      parts.push(details)
    }
  }

  if (supporting.length) {
    parts.push('【重要配角（一句话+关系）】')
    for (const c of supporting) {
      parts.push(`${c.name}：${c.shortDescription || '（无描述）'}${c.relationships ? `，关系：${c.relationships.slice(0, 80)}` : ''}`)
    }
  }

  if (others.length) {
    parts.push('【其他角色（仅名字）】')
    parts.push(others.map(c => `${c.name}（${getRoleLabel(c.role)}）`).join('、'))
  }

  return parts.join('\n')
}

/**
 * Phase G2: 过滤活跃角色
 * 只保留在当前章节范围内活跃的角色（主角/反派始终保留）
 */
export function filterActiveCharacters(characters: Character[], currentChapterId?: number): Character[] {
  if (!currentChapterId) return characters
  return characters.filter(c => {
    // 主角和反派始终保留
    if (c.role === 'protagonist' || c.role === 'antagonist') return true
    // 如果设了退场章节且当前章节已过退场点，过滤掉
    if (c.exitChapterId && c.exitChapterId < currentChapterId) return false
    // 如果设了首次出场且当前章节还没到，过滤掉
    if (c.firstAppearChapterId && c.firstAppearChapterId > currentChapterId) return false
    return true
  })
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

/**
 * Phase 19-d: 构建大师洞察上下文 —— 从 masterInsights 表读取洞察注入创作 prompt。
 */
export async function buildMasterInsightContext(insightIds: number[]): Promise<string> {
  if (!insightIds.length) return ''

  const parts: string[] = []
  for (const id of insightIds) {
    const insight = await db.masterInsights.get(id)
    if (!insight) continue
    const bullets = insight.bulletPoints.map(b => `  - ${b}`).join('\n')
    parts.push(`【${insight.title}】${insight.genre ? `（${insight.genre}）` : ''}\n${insight.description.slice(0, 500)}\n要点：\n${bullets}`)
  }

  if (!parts.length) return ''
  return `【大师洞察 — 请参考以下创作方法论来指导写作】\n\n${parts.join('\n\n')}\n\n【大师洞察结束 — 请灵活运用，不要生搬硬套】`
}

/** 构建世界观各维度已有内容（用于 AI 生成时做参考） */
// ── Phase 31.1: 历史模式上下文注入 ──────────────────────────────

/**
 * 构建历史时间线 + 关键词上下文
 *
 * 从 DB 读取项目的历史事件和关键词，格式化为 AI 可用的上下文。
 * Token 预算控制：最多 2000 字（约上下文窗口的 10%）。
 */
export async function buildHistoricalContext(projectId: number): Promise<string> {
  const MAX_CHARS = 2000
  const parts: string[] = []
  let charCount = 0

  // 1. 历史时间线事件（按年份排序，取关键事件）
  const events = await db.historicalTimelineEvents
    .where('projectId').equals(projectId)
    .sortBy('year')

  if (events.length > 0) {
    const eventLines: string[] = ['【历史时间线】']
    for (const e of events) {
      const marker = e.isHistorical ? '📜史实' : '✨虚构'
      const line = `- ${e.date}（${marker}）：${e.title}${e.description ? `——${e.description.slice(0, 80)}` : ''}`
      if (charCount + line.length > MAX_CHARS * 0.6) break // 事件最多占 60%
      eventLines.push(line)
      charCount += line.length
    }
    if (eventLines.length > 1) {
      parts.push(eventLines.join('\n'))
    }
  }

  // 2. 历史关键词（按分类分组）
  const keywords = await db.historicalKeywords
    .where('projectId').equals(projectId)
    .toArray()

  if (keywords.length > 0) {
    const byCategory = new Map<HistoricalKeywordCategory, HistoricalKeyword[]>()
    for (const kw of keywords) {
      const list = byCategory.get(kw.category) || []
      list.push(kw)
      byCategory.set(kw.category, list)
    }

    const kwLines: string[] = ['【时代关键词——创作中必须使用这些时代元素，禁止超越时代的物品/制度】']
    for (const [cat, kws] of byCategory) {
      const label = KEYWORD_CATEGORY_LABELS[cat] || cat
      const items = kws.map(k => {
        const desc = k.description ? `（${k.description.slice(0, 40)}）` : ''
        return `${k.keyword}${desc}`
      }).join('、')
      const line = `· ${label}：${items}`
      if (charCount + line.length > MAX_CHARS) break
      kwLines.push(line)
      charCount += line.length
    }
    if (kwLines.length > 1) {
      parts.push(kwLines.join('\n'))
    }
  }

  if (!parts.length) return ''
  return parts.join('\n\n')
}

/**
 * 构建「重要地点」上下文。此前重要地点表从不进入写作链路（仅用于地图生成），
 * 导致作者建的地点在 AI 写正文时读不到。此函数补齐。
 * @param worldGroupId 多世界：当前世界（importantLocations 暂无世界字段，按项目全量，预算限制）
 */
export async function buildLocationContext(projectId: number): Promise<string> {
  const locs = await db.importantLocations.where('projectId').equals(projectId).toArray()
  if (!locs.length) return ''
  const sorted = locs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).slice(0, 25)
  const lines = sorted.map(l => {
    const sig = l.significance ? `（${l.significance.slice(0, 50)}）` : ''
    const desc = l.description ? `：${l.description.slice(0, 60)}` : ''
    return `- ${l.name}${sig}${desc}`
  })
  return `【重要地点】\n${lines.join('\n')}`.slice(0, 1200)
}
