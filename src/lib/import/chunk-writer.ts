/**
 * 把一块解析结果即时写入 DB（worldview / characters / outline 三表）。
 *
 * 从 pipeline.ts 抽出。这里有 side effect（写 DB + 触发 store load），
 * 但逻辑上是"给我一个解析结果 → 落库 → 告诉我条数"，与流水线控制流完全解耦。
 */

import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useOutlineStore } from '../../stores/outline'
import type { UnifiedParseResult } from '../types'
import type { CharacterRole } from '../types'

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
): Promise<ApplyChunkCounts> {
  let worldviewFields = 0
  let charactersAdded = 0
  let outlineAdded = 0

  // ── 世界观：合并写 ─────────────────────────────────────────────
  if (result.worldview) {
    const wvStore = useWorldviewStore.getState()
    await wvStore.loadAll(projectId)
    const existing = useWorldviewStore.getState().worldview
    const patch: Record<string, string> = {}
    for (const [k, v] of Object.entries(result.worldview)) {
      if (typeof v === 'string' && v.trim()) {
        const cur = (existing?.[k as keyof typeof existing] as string) || ''
        // 同字段已有内容就追加（避免覆盖前面块的内容）
        patch[k] = cur ? `${cur}\n\n${v.trim()}` : v.trim()
        worldviewFields++
      }
    }
    if (Object.keys(patch).length > 0) {
      await wvStore.saveWorldview({ projectId, ...patch })
    }
  }

  // ── 角色：直接 add（合并交给跨块合并 step） ──────────────────
  if (Array.isArray(result.characters)) {
    const chStore = useCharacterStore.getState()
    for (const c of result.characters) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) continue
      const role = (c.role as CharacterRole) || 'minor'
      await chStore.addCharacter({
        projectId,
        name: c.name.trim(),
        role,
        shortDescription: String(c.shortDescription || ''),
        appearance: String(c.appearance || ''),
        personality: String(c.personality || ''),
        background: String(c.background || ''),
        motivation: String(c.motivation || ''),
        abilities: String(c.abilities || ''),
        relationships: String(c.relationships || ''),
        arc: String(c.arc || ''),
      })
      charactersAdded++
    }
  }

  // ── 大纲：递归写 ───────────────────────────────────────────────
  if (Array.isArray(result.outline)) {
    const olStore = useOutlineStore.getState()
    const writeNode = async (
      node: Record<string, unknown>,
      parentId: number | null,
      orderRef: { value: number },
    ): Promise<void> => {
      if (!node || typeof node.title !== 'string' || !node.title.trim()) return
      const isVolume = node.type === 'volume' ||
        (Array.isArray(node.children) && node.children.length > 0)
      const id = await olStore.addNode({
        projectId,
        parentId,
        type: isVolume ? 'volume' : 'chapter',
        title: node.title.trim(),
        summary: String(node.summary || ''),
        order: orderRef.value++,
      })
      outlineAdded++
      if (Array.isArray(node.children)) {
        const childOrder = { value: 0 }
        for (const c of node.children) {
          await writeNode(c as Record<string, unknown>, id, childOrder)
        }
      }
    }
    // 顶层 order 接着已有大纲数量
    await olStore.loadAll(projectId)
    const startOrder = useOutlineStore.getState().nodes
      .filter(n => n.parentId === null).length
    const ref = { value: startOrder }
    for (const n of result.outline) {
      await writeNode(n as Record<string, unknown>, null, ref)
    }
  }

  return {
    worldviewFields,
    characters: charactersAdded,
    outlineNodes: outlineAdded,
  }
}
