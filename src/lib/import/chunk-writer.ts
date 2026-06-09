/**
 * 把一块解析结果即时写入 DB（worldview / characters / outline 三表）。
 *
 * 从 pipeline.ts 抽出。这里有 side effect（写 DB + 触发 store load），
 * 但逻辑上是"给我一个解析结果 → 落库 → 告诉我条数"，与流水线控制流完全解耦。
 */

import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useOutlineStore } from '../../stores/outline'
import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import type { UnifiedParseResult } from '../types'
import type { CharacterRole } from '../types'
import {
  deduplicateWorldviewText,
  checkCharacterDuplicate,
  mergeCharacterFields,
  checkOutlineDuplicate,
} from './dedup'

export interface ApplyChunkCounts {
  worldviewFields: number
  characters: number
  outlineNodes: number
}

/**
 * 把单块解析结果写入对应的三张表。
 * - worldview：同字段已有内容 → 追加（\n\n 连接）；空字段 → 新写
 * - characters：直接 add（跨块重名合并由 runCharacterMerge 处理）
 * - outline：递归写入，顶层 order 接着已有数量
 */
export async function applyChunkResult(
  projectId: number,
  result: UnifiedParseResult,
  worldGroupId: number | null = null,
): Promise<ApplyChunkCounts> {
  const targetWorldGroupId = worldGroupId ?? null
  let worldviewFields = 0
  let charactersAdded = 0
  let outlineAdded = 0

  // ── 世界观：合并写（Phase 30.5: 句子级去重） ────────────────────
  if (result.worldview) {
    const wvStore = useWorldviewStore.getState()
    await wvStore.loadAll(projectId, targetWorldGroupId)
    const existing = useWorldviewStore.getState().worldview
    const patch: Record<string, string> = {}
    for (const [k, v] of Object.entries(result.worldview)) {
      if (typeof v === 'string' && v.trim()) {
        const cur = (existing?.[k as keyof typeof existing] as string) || ''
        if (!cur) {
          // 空字段直接写
          patch[k] = v.trim()
          worldviewFields++
        } else {
          // Phase 30.5: 句子级去重后追加（过滤与已有内容高度相似的句子）
          const dedupedText = deduplicateWorldviewText(cur, v.trim())
          if (dedupedText) {
            patch[k] = `${cur}\n\n${dedupedText}`
            worldviewFields++
          }
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      await adopt({
        projectId,
        worldGroupId: targetWorldGroupId,
        target: 'worldviews',
        mode: 'replace',
        data: patch,
      })
      await wvStore.loadAll(projectId, targetWorldGroupId)
    }
  }

  // ── 角色：去重后写入（Phase 30.5: 同名角色合并） ──────────────
  if (Array.isArray(result.characters)) {
    const chStore = useCharacterStore.getState()
    await chStore.loadAll(projectId)
    const existingChars = useCharacterStore.getState().characters
      .filter(ch => (ch.homeWorldGroupId ?? null) === targetWorldGroupId)
    // 建立名字→ID映射
    const nameMap = new Map<string, number>()
    for (const ch of existingChars) {
      if (ch.id != null) nameMap.set(ch.name, ch.id)
    }

    for (const c of result.characters) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) continue
      const role = (c.role as CharacterRole) || 'minor'
      const incomingFields: Record<string, string> = {
        shortDescription: String(c.shortDescription || ''),
        appearance: String(c.appearance || ''),
        personality: String(c.personality || ''),
        background: String(c.background || ''),
        motivation: String(c.motivation || ''),
        abilities: String(c.abilities || ''),
        relationships: String(c.relationships || ''),
        arc: String(c.arc || ''),
      }

      // Phase 30.5: 检查同名角色
      const dedup = checkCharacterDuplicate(c.name.trim(), nameMap)
      if (dedup.isDuplicate && dedup.existingId != null) {
        // 已有同名角色 → 合并字段（追加不覆盖）
        const existing = existingChars.find(ch => ch.id === dedup.existingId)
        if (existing) {
          const existingFields: Record<string, string> = {
            shortDescription: existing.shortDescription || '',
            appearance: existing.appearance || '',
            personality: existing.personality || '',
            background: existing.background || '',
            motivation: existing.motivation || '',
            abilities: existing.abilities || '',
            relationships: existing.relationships || '',
            arc: existing.arc || '',
          }
          const merged = mergeCharacterFields(existingFields, incomingFields)
          await adopt({
            projectId,
            worldGroupId: targetWorldGroupId,
            target: 'characters',
            mode: 'add',
            data: {
              name: c.name.trim(),
              role,
              homeWorldGroupId: targetWorldGroupId,
              ...merged,
            },
          })
          charactersAdded++ // 仍然计数（表示处理了一个角色）
        }
      } else {
        // 新角色 → 直接创建
        const charName = String(c.name).trim()
        await adopt({
          projectId,
          worldGroupId: targetWorldGroupId,
          target: 'characters',
          mode: 'add',
          data: {
            name: charName,
            role,
            homeWorldGroupId: targetWorldGroupId,
            shortDescription: incomingFields.shortDescription,
            appearance: incomingFields.appearance,
            personality: incomingFields.personality,
            background: incomingFields.background,
            motivation: incomingFields.motivation,
            abilities: incomingFields.abilities,
            relationships: incomingFields.relationships,
            arc: incomingFields.arc,
          },
        })
        // 更新映射以便同块内后续角色也能去重
        const newChars = await db.characters.where('projectId').equals(projectId).toArray()
        const added = newChars.find(ch =>
          ch.name === charName && (ch.homeWorldGroupId ?? null) === targetWorldGroupId)
        if (added?.id != null) nameMap.set(added.name, added.id)
        charactersAdded++
      }
    }
    await chStore.loadAll(projectId)
  }

  // ── 大纲：递归写（Phase 28.4: 支持将章节挂到已存在的同名卷下） ──
  if (Array.isArray(result.outline)) {
    const olStore = useOutlineStore.getState()
    await olStore.loadAll(projectId)
    const existingNodes = [...useOutlineStore.getState().nodes]
      .filter(n => (n.worldGroupId ?? null) === targetWorldGroupId)

    // 已有卷节点的名称→ID映射（用于匹配 AI 返回的卷标题）
    const volumeMap = new Map<string, number>()
    for (const n of existingNodes) {
      if (n.type === 'volume' && n.parentId === null && n.id != null) {
        volumeMap.set(n.title, n.id)
        // 也存去掉前导空格和装饰符号的版本
        const clean = n.title.replace(/^[\s　【】\[\]]+|[\s　【】\[\]]+$/g, '')
        if (clean !== n.title) volumeMap.set(clean, n.id)
      }
    }

    /** 尝试找到匹配的已有卷 ID */
    const findVolumeId = (title: string): number | null => {
      const t = title.trim()
      if (volumeMap.has(t)) return volumeMap.get(t)!
      // 模糊：标题包含关系
      for (const [vt, vid] of volumeMap) {
        if (vt.includes(t) || t.includes(vt)) return vid
      }
      return null
    }

    const writeNode = async (
      node: Record<string, unknown>,
      parentId: number | null,
      orderRef: { value: number },
    ): Promise<void> => {
      if (!node || typeof node.title !== 'string' || !node.title.trim()) return
      const isVolume = node.type === 'volume' ||
        (Array.isArray(node.children) && node.children.length > 0)

      // Phase 28.4: 如果是顶层卷且已有同名卷，跳过创建，复用已有卷 ID
      if (isVolume && parentId === null) {
        const existingId = findVolumeId(node.title.trim())
        if (existingId != null) {
          // 补充摘要（如果已有卷摘要为空）
          const existingVol = existingNodes.find(n => n.id === existingId)
          if (existingVol && !existingVol.summary && node.summary) {
            await olStore.updateNode(existingId, { summary: String(node.summary) })
          }
          // 子节点挂到已有卷下
          if (Array.isArray(node.children)) {
            const childStart = existingNodes.filter(n => n.parentId === existingId).length
            const childRef = { value: childStart }
            for (const c of node.children) {
              await writeNode(c as Record<string, unknown>, existingId, childRef)
            }
          }
          return
        }
      }

      // Phase 30.5: 大纲去重 — 检查同层级是否已有相同标题的节点
      const siblings = existingNodes.filter(n => n.parentId === parentId)
      const dupCheck = checkOutlineDuplicate(
        node.title.trim(),
        String(node.summary || ''),
        siblings,
      )
      if (dupCheck.isDuplicate && dupCheck.existingId != null) {
        // 已有相似节点 → 跳过创建，但如果有摘要且已有为空则补充
        const existNode = existingNodes.find(n => n.id === dupCheck.existingId)
        if (existNode && !existNode.summary && node.summary) {
          await olStore.updateNode(dupCheck.existingId, { summary: String(node.summary) })
        }
        // 如果有子节点，仍然递归写（挂到已有节点下）
        if (Array.isArray(node.children)) {
          const childStart = existingNodes.filter(n => n.parentId === dupCheck.existingId).length
          const childRef = { value: childStart }
          for (const c of node.children) {
            await writeNode(c as Record<string, unknown>, dupCheck.existingId!, childRef)
          }
        }
        return
      }

      const adopted = await adopt({
        projectId,
        worldGroupId: targetWorldGroupId,
        target: 'outlineNodes',
        mode: 'add',
        data: {
          parentId,
          type: isVolume ? 'volume' : 'chapter',
          worldGroupId: targetWorldGroupId,
          title: node.title.trim(),
          summary: String(node.summary || ''),
          order: orderRef.value++,
        },
      })
      const id = adopted.written[0]?.id
      if (id == null) return
      outlineAdded++
      // 更新 existingNodes 以便同块内后续节点也能去重
      existingNodes.push({
        id: id as number,
        projectId,
        parentId,
        type: isVolume ? 'volume' : 'chapter',
        worldGroupId: targetWorldGroupId,
        title: node.title.trim(),
        summary: String(node.summary || ''),
        order: orderRef.value - 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      if (Array.isArray(node.children)) {
        const childOrder = { value: 0 }
        for (const c of node.children) {
          await writeNode(c as Record<string, unknown>, id, childOrder)
        }
      }
    }
    // 顶层 order 接着已有大纲数量
    const startOrder = existingNodes
      .filter(n => n.parentId === null).length
    const ref = { value: startOrder }
    for (const n of result.outline) {
      await writeNode(n as Record<string, unknown>, null, ref)
    }
    await olStore.loadAll(projectId)
  }

  return {
    worldviewFields,
    characters: charactersAdded,
    outlineNodes: outlineAdded,
  }
}
