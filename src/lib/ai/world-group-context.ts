/**
 * Phase 25.4 — 多世界 AI 上下文构建
 *
 * 提供两个层级的上下文：
 *   - buildCurrentWorldContext：单个世界的完整设定（给"在某世界内生成"用）
 *   - buildAllWorldsOverview：所有世界的精简摘要（给跨世界/世界管理用）
 */
import { db } from '../db/schema'
import { WORLD_GROUP_TYPE_LABELS } from '../types/world-group'
import { buildCodexContext } from './codex-context'
import type { Worldview, PowerSystem } from '../types'

/** 取某世界组下的世界观（按 worldGroupId 匹配） */
async function getGroupWorldview(projectId: number, worldGroupId: number): Promise<Worldview | undefined> {
  const all = await db.worldviews.where('projectId').equals(projectId).toArray()
  return all.find(w => w.worldGroupId === worldGroupId)
}

/** 取某世界组下的力量体系 */
async function getGroupPowerSystem(projectId: number, worldGroupId: number): Promise<PowerSystem | undefined> {
  const all = await db.powerSystems.where('projectId').equals(projectId).toArray()
  return all.find(p => p.worldGroupId === worldGroupId)
}

/**
 * 构建当前世界的完整上下文（约 1500-3000 字）
 * 用于章节/大纲/细纲等"在某个世界内工作"的 AI 生成。
 */
export async function buildCurrentWorldContext(
  projectId: number,
  worldGroupId: number,
): Promise<string> {
  const group = await db.worldGroups.get(worldGroupId)
  if (!group) return ''

  const parts: string[] = []
  parts.push(`【当前世界：${group.name}】（${WORLD_GROUP_TYPE_LABELS[group.type]}）`)
  if (group.description) parts.push(`概述：${group.description}`)
  if (group.powerRestriction) parts.push(`能力限制：${group.powerRestriction}`)
  if (group.entryCondition) parts.push(`进入条件：${group.entryCondition}`)

  const wv = await getGroupWorldview(projectId, worldGroupId)
  if (wv) {
    const wvParts = [
      wv.worldOrigin && `世界来源：${wv.worldOrigin.slice(0, 300)}`,
      wv.powerHierarchy && `力量体系：${wv.powerHierarchy.slice(0, 200)}`,
      wv.worldStructure && `世界结构：${wv.worldStructure.slice(0, 150)}`,
      wv.continentLayout && `地貌分布：${wv.continentLayout.slice(0, 200)}`,
      wv.climateByRegion && `气候环境：${wv.climateByRegion.slice(0, 100)}`,
      wv.historyLine && `世界历史：${wv.historyLine.slice(0, 200)}`,
      wv.races && `种族民族：${wv.races.slice(0, 150)}`,
      wv.factionLayout && `势力分布：${wv.factionLayout.slice(0, 200)}`,
      wv.politicsEconomyCulture && `政经文化：${wv.politicsEconomyCulture.slice(0, 150)}`,
    ].filter(Boolean)
    if (wvParts.length) parts.push(`\n【世界观】\n${wvParts.join('\n')}`)
  }

  const ps = await getGroupPowerSystem(projectId, worldGroupId)
  if (ps?.name) {
    parts.push(`\n【力量体系】${ps.name}：${ps.description?.slice(0, 200) || ''}`)
  }

  // Phase 35-a：注入本世界的设定词条（上游设定）
  const codex = await buildCodexContext(projectId, worldGroupId)
  if (codex) parts.push(`\n${codex}`)

  return parts.join('\n').slice(0, 3000)
}

/**
 * 构建所有世界的精简摘要表（每世界限 ~100 字）
 * 用于世界建议、跨世界规划、灵感反推等需要全局视野的场景。
 */
export async function buildAllWorldsOverview(projectId: number): Promise<string> {
  const groups = await db.worldGroups.where('projectId').equals(projectId).sortBy('order')
  if (groups.length === 0) return ''

  const allWv = await db.worldviews.where('projectId').equals(projectId).toArray()

  const lines: string[] = ['【本项目已有世界】']
  for (const g of groups) {
    const wv = allWv.find(w => w.worldGroupId === g.id)
    // 取该世界最具代表性的一句话设定
    const essence = g.description
      || wv?.worldOrigin?.slice(0, 80)
      || wv?.powerHierarchy?.slice(0, 80)
      || '（暂无设定）'
    lines.push(`${g.icon || '🌐'} ${g.name}（${WORLD_GROUP_TYPE_LABELS[g.type]}）：${essence.slice(0, 100)}`)
  }
  return lines.join('\n')
}
