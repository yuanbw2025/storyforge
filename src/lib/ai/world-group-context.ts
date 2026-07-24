/**
 * Phase 25.4 — 多世界 AI 上下文构建
 *
 * 这里只保留“所有世界概览”这一非生成辅助视图。
 * 单世界生成上下文已统一由 CONTEXT_SOURCES + assembleContext() 提供。
 */
import { db } from '../db/schema'
import { WORLD_GROUP_TYPE_LABELS } from '../types/world-group'

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
