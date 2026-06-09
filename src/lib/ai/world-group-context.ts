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
import { formatWorldviewBlock, formatPowerSystemBlock, formatStoryCoreBlock } from './context-builder'
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

  // 单一事实源：与单世界共用同一套字段格式化，杜绝单/多世界漂移
  const wv = await getGroupWorldview(projectId, worldGroupId)
  const wvBlock = formatWorldviewBlock(wv ?? null)
  if (wvBlock) parts.push(`\n${wvBlock}`)

  const ps = await getGroupPowerSystem(projectId, worldGroupId)
  const psBlock = formatPowerSystemBlock(ps ?? null)
  if (psBlock) parts.push(`\n${psBlock}`)

  // 故事核心（项目级，与单世界对齐——此前多世界遗漏）
  const sc = await db.storyCores.where('projectId').equals(projectId).first()
  const scBlock = formatStoryCoreBlock(sc ?? null)
  if (scBlock) parts.push(`\n${scBlock}`)

  // Phase 35-a：注入本世界的设定词条（上游设定）
  const codex = await buildCodexContext(projectId, worldGroupId)
  if (codex) parts.push(`\n${codex}`)

  return parts.join('\n').slice(0, 3000)
}

/** 沿大纲节点父链解析其所属世界组（多世界）。无则返回 null。 */
export async function resolveNodeWorldGroupId(projectId: number, outlineNodeId: number): Promise<number | null> {
  const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
  let cur = nodes.find(n => n.id === outlineNodeId)
  const guard = new Set<number>()
  while (cur && !guard.has(cur.id!)) {
    if (cur.worldGroupId != null) return cur.worldGroupId
    guard.add(cur.id!)
    cur = cur.parentId != null ? nodes.find(n => n.id === cur!.parentId) : undefined
  }
  return null
}

/**
 * 为「某个章节/大纲节点」构建正确的世界上下文。
 * 多世界：解析该节点所属世界 → buildCurrentWorldContext（含该世界词条/故事核心）。
 * 单世界 或 节点未归属世界：读项目级世界观 + 词条，与 buildWorldContext 同字段（共享格式化）。
 * 解决「场景/细纲等面板在多世界下读错世界」的问题。
 */
export async function buildNodeWritingContext(
  projectId: number,
  outlineNodeId: number | null,
): Promise<string> {
  const project = await db.projects.get(projectId)
  if (project?.enableMultiWorld && outlineNodeId != null) {
    const wg = await resolveNodeWorldGroupId(projectId, outlineNodeId)
    if (wg != null) return await buildCurrentWorldContext(projectId, wg)
  }
  // 单世界 / 未归属：项目级（worldGroupId=null）
  const [wvList, sc, psList] = await Promise.all([
    db.worldviews.where('projectId').equals(projectId).toArray(),
    db.storyCores.where('projectId').equals(projectId).first(),
    db.powerSystems.where('projectId').equals(projectId).toArray(),
  ])
  const wv = wvList.find(w => (w.worldGroupId ?? null) === null) ?? wvList[0] ?? null
  const ps = psList.find(p => (p.worldGroupId ?? null) === null) ?? psList[0] ?? null
  const codex = await buildCodexContext(projectId, null)
  return [
    formatWorldviewBlock(wv),
    formatStoryCoreBlock(sc ?? null),
    formatPowerSystemBlock(ps),
    codex,
  ].filter(Boolean).join('\n\n')
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
