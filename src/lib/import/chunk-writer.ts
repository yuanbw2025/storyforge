/**
 * 把一块解析结果即时写入 DB（worldview / characters / outline 三表）。
 *
 * 从 pipeline.ts 抽出。这里有 side effect（写 DB + 触发 store load），
 * 但逻辑上是"给我一个解析结果 → 落库 → 告诉我条数"，与流水线控制流完全解耦。
 */

import { useCharacterStore } from '../../stores/character'
import { useWorldviewStore } from '../../stores/worldview'
import { useOutlineStore } from '../../stores/outline'
import Dexie from 'dexie'
import { adopt, adoptionTransactionTablesV1 } from '../registry/adopt'
import type { AdoptResult } from '../registry/types'
import type { Character, OutlineNode, UnifiedParseResult, Worldview } from '../types'
import { CHARACTER_DIMENSIONS } from '../character/character-dimensions'
import { isCompleteCharacterAxes } from '../character/character-axes'
import { readOwnedRows, resolveScopeLike, type WorkspaceScopeLike } from '../workspace/scope'
import {
  deduplicateWorldviewText,
  mergeCharacterFields,
  checkOutlineDuplicate,
} from './dedup'

// 角色文字字段单一事实源：所有维度 + relationships(非维度，单列保留)。加维度自动跟随导入。
const CHARACTER_TEXT_KEYS = [...CHARACTER_DIMENSIONS.map(d => d.key), 'relationships'] as const
const pickCharacterFields = (src: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(CHARACTER_TEXT_KEYS.map(k => [k, String(src[k] ?? '')]))

export interface ApplyChunkCounts {
  worldviewFields: number
  characters: number
  outlineNodes: number
  /** Phase 35-c 候选只暂存在会话中，不在本函数写入 Codex。 */
  codexCandidates?: number
}

type ConfirmedChunkWrites = { target: string; rows: AdoptResult['written'] }[]
const CHUNK_TARGETS = ['worldviews', 'geographies', 'histories', 'characters', 'outlineNodes'] as const

export function importChunkAdoptionTablesV1() {
  // Canon adoption can invalidate dependent source assertions.
  return [...new Set(CHUNK_TARGETS.flatMap(target => adoptionTransactionTablesV1(target, undefined, { callerOwned: true })))]
}

export function refreshImportedChunkStoresV1(scope: Awaited<ReturnType<typeof resolveScopeLike>>, worldGroupId: number | null) {
  return Promise.all([
    useWorldviewStore.getState().loadAll(scope, worldGroupId),
    useCharacterStore.getState().loadAll(scope),
    useOutlineStore.getState().loadAll(scope),
  ])
}

/**
 * 把单块解析结果写入对应的三张表。
 * - worldview：同字段已有内容 → 追加（\n\n 连接）；空字段 → 新写
 * - characters：按当前目标世界中明确同名的角色追加内容，不删除异名角色
 * - outline：递归写入，顶层 order 接着已有数量
 */
export function applyChunkResult(
  scopeInput: WorkspaceScopeLike,
  result: UnifiedParseResult,
  worldGroupId: number | null = null,
  guard?: () => Promise<void>,
  confirmedWrites?: ConfirmedChunkWrites,
): Promise<ApplyChunkCounts> {
  const sequence = applyChunkInSequence(scopeInput, result, worldGroupId, guard, confirmedWrites)
  const advance = (state: IteratorResult<Promise<unknown>, ApplyChunkCounts>): Promise<ApplyChunkCounts> =>
    state.done ? Dexie.Promise.resolve(state.value) :
      Dexie.Promise.resolve(state.value).then(value => advance(sequence.next(value)))
  return Dexie.Promise.resolve().then(() => advance(sequence.next()))
}

function* inDexieScope<T>(pending: Promise<T>): Generator<Promise<unknown>, T, unknown> {
  return (yield pending) as T
}

// Dexie promises advance this generator in the caller transaction zone. Do not
// use native async continuations between scoped reads and registered writes.
function* applyChunkInSequence(
  scopeInput: WorkspaceScopeLike, result: UnifiedParseResult, worldGroupId: number | null,
  guard?: () => Promise<void>, confirmedWrites?: ConfirmedChunkWrites,
): Generator<Promise<unknown>, ApplyChunkCounts, unknown> {
  const transaction = Dexie.currentTransaction
  const checkTransaction = () => {
    if (confirmedWrites && (!transaction || !transaction.active || Dexie.currentTransaction !== transaction))
      throw new Error('导入候选必须在原确认事务中采纳。')
  }
  checkTransaction()
  const scope = yield* inDexieScope(resolveScopeLike(scopeInput))
  const { projectId } = scope
  const adoptScoped = function* (input: Parameters<typeof adopt>[0]): Generator<Promise<unknown>, AdoptResult, unknown> {
    if (guard) yield* inDexieScope(guard())
    checkTransaction()
    const adopted = yield* inDexieScope(adopt({ ...input, scope }, confirmedWrites && transaction ? { transaction } : undefined))
    checkTransaction()
    if (confirmedWrites) {
      if (!adopted.written.length || adopted.unknown.length || adopted.typeErrors.length ||
        adopted.fkErrors.length || adopted.skipped.length) {
        throw new Error(`导入候选未完整写入 ${input.target}：${adopted.skipped[0]?.reason ??
          [...adopted.unknown, ...adopted.typeErrors.map(item => item.field), ...adopted.fkErrors.map(item => item.field)].join('、')}`)
      }
      confirmedWrites.push({ target: input.target, rows: adopted.written })
    }
    return adopted
  }
  if (guard) yield* inDexieScope(guard())
  const targetWorldGroupId = worldGroupId ?? null
  let worldviewFields = 0
  let charactersAdded = 0
  let outlineAdded = 0

  const mergeWorldOverview = function* (
    target: 'geographies' | 'histories',
    incoming: string | undefined,
  ): Generator<Promise<unknown>, number, unknown> {
    const value = incoming?.trim()
    if (!value) return 0
    const rows = yield* inDexieScope(readOwnedRows<Record<string, unknown>>(scope, target, { owner: 'world' }))
    const existing = rows.find(row => (row.worldGroupId ?? null) === targetWorldGroupId)
    const current = typeof existing?.overview === 'string' ? existing.overview : ''
    const addition = deduplicateWorldviewText(current, value)
    if (!addition) return 0
    yield* adoptScoped({
      projectId,
      scope,
      worldGroupId: targetWorldGroupId,
      target,
      mode: 'replace',
      data: { overview: current ? `${current}\n\n${addition}` : addition },
    })
    return 1
  }

  // ── 世界观：合并写（Phase 30.5: 句子级去重） ────────────────────
  if (result.worldview) {
    const wvStore = useWorldviewStore.getState()
    const existing = (yield* inDexieScope(readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' })))
      .find(row => (row.worldGroupId ?? null) === targetWorldGroupId)
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
      yield* adoptScoped({
        projectId,
        worldGroupId: targetWorldGroupId,
        target: 'worldviews',
        mode: 'replace',
        data: patch,
      })
      if (guard) yield* inDexieScope(guard())
      if (!confirmedWrites) yield* inDexieScope(wvStore.loadAll(scope, targetWorldGroupId))
    }
  }

  worldviewFields += yield* mergeWorldOverview('geographies', result.geography?.overview)
  worldviewFields += yield* mergeWorldOverview('histories', result.history?.overview)

  // ── 角色：去重后写入（Phase 30.5: 同名角色合并） ──────────────
  if (Array.isArray(result.characters)) {
    const chStore = useCharacterStore.getState()
    const existingChars = (yield* inDexieScope(readOwnedRows<Character>(scope, 'characters', { owner: 'world' })))
      .filter(ch => (ch.homeWorldGroupId ?? null) === targetWorldGroupId)
    const byName = new Map(existingChars.filter(character => character.id != null).map(character => [character.name, character]))
    for (const c of result.characters) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) continue
      const name = c.name.trim()
      const incoming = pickCharacterFields(c as Record<string, unknown>)
      const existing = byName.get(name)
      if (existing?.id != null) {
        // The author reviewed the new excerpt. Preserve the existing role
        // identity and its current classification; merge only text additions.
        const current = pickCharacterFields(existing as unknown as Record<string, unknown>)
        const merged = mergeCharacterFields(current, incoming)
        const additions = Object.fromEntries(Object.entries(merged).filter(([field, value]) => value !== current[field]))
        if (!Object.keys(additions).length) continue
        yield* adoptScoped({ projectId, worldGroupId: targetWorldGroupId, target: 'characters',
          recordId: existing.id, mode: 'replace', data: additions })
        Object.assign(existing, additions)
      } else {
        if (!isCompleteCharacterAxes(c)) throw new Error(`[import] 角色「${name}」缺少当前三轴分类`)
        const data = { name, roleWeight: c.roleWeight, moralAxis: c.moralAxis, orderAxis: c.orderAxis,
          homeWorldGroupId: targetWorldGroupId, ...incoming }
        const adopted = yield* adoptScoped({ projectId, worldGroupId: targetWorldGroupId,
          target: 'characters', mode: 'add', data })
        const id = adopted.written[0]?.id
        if (id != null) byName.set(name, { ...data, id, projectId, createdAt: Date.now(), updatedAt: Date.now() } as Character)
      }
      charactersAdded++
    }
    if (guard) yield* inDexieScope(guard())
    if (!confirmedWrites) yield* inDexieScope(chStore.loadAll(scope))
  }

  // ── 大纲：递归写（Phase 28.4: 支持将章节挂到已存在的同名卷下） ──
  if (Array.isArray(result.outline)) {
    const olStore = useOutlineStore.getState()
    const existingNodes = (yield* inDexieScope(readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })))
      .filter(n => (n.worldGroupId ?? null) === targetWorldGroupId)

    // 已有卷节点的名称→ID映射（用于匹配 AI 返回的卷标题）
    const volumeMap = new Map<string, number>()
    for (const n of existingNodes) {
      if (n.type === 'volume' && n.parentId === null && n.id != null) {
        volumeMap.set(n.title, n.id)
        // 也存去掉前导空格和装饰符号的版本
        const clean = n.title.replace(/^[\s\u3000【】[\]]+|[\s\u3000【】[\]]+$/g, '')
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

    const fillOutlineSummary = function* (record: OutlineNode, value: unknown): Generator<Promise<unknown>, void, unknown> {
      if (record.id == null) return
      const summary = String(value)
      if (confirmedWrites) {
        yield* adoptScoped({ projectId, worldGroupId: targetWorldGroupId, target: 'outlineNodes',
          mode: 'replace', recordId: record.id, data: { summary } })
        record.summary = summary
      } else {
        if (guard) yield* inDexieScope(guard())
        yield* inDexieScope(olStore.updateNode(record.id, { summary }, { scope,
          expected: { summary: record.summary, updatedAt: record.updatedAt } }))
      }
    }

    const writeNode = function* (
      node: Record<string, unknown>,
      parentId: number | null,
      orderRef: { value: number },
    ): Generator<Promise<unknown>, void, unknown> {
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
            yield* fillOutlineSummary(existingVol, node.summary)
          }
          // 子节点挂到已有卷下
          if (Array.isArray(node.children)) {
            const childStart = existingNodes.filter(n => n.parentId === existingId).length
            const childRef = { value: childStart }
            for (const c of node.children) {
              yield* writeNode(c as Record<string, unknown>, existingId, childRef)
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
          yield* fillOutlineSummary(existNode, node.summary)
        }
        // 如果有子节点，仍然递归写（挂到已有节点下）
        if (Array.isArray(node.children)) {
          const childStart = existingNodes.filter(n => n.parentId === dupCheck.existingId).length
          const childRef = { value: childStart }
          for (const c of node.children) {
            yield* writeNode(c as Record<string, unknown>, dupCheck.existingId!, childRef)
          }
        }
        return
      }

      const adopted = yield* adoptScoped({
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
          yield* writeNode(c as Record<string, unknown>, id, childOrder)
        }
      }
    }
    // FB-6 修复:某些块的 AI 输出是「扁平章节列表」(无卷包裹)。若直接以 parentId=null
    // 写入,会成为顶层孤儿章节——已入库但大纲面板只渲染「卷→章」,导致看不到(表现为
    // "导入N块却只显示第1块")。这里把顶层章节统一挂到一个卷下:优先复用最后一个已有卷,
    // 没有则建一个兜底卷「导入章节」。
    const isVolumeNode = (node: Record<string, unknown>): boolean =>
      node.type === 'volume' || (Array.isArray(node.children) && node.children.length > 0)
    const hasOrphanChapter = result.outline.some(n => !isVolumeNode(n as Record<string, unknown>))

    let fallbackVolumeId: number | null = null
    const fallbackChildRef = { value: 0 }
    if (hasOrphanChapter) {
      const vols = existingNodes.filter(n => n.type === 'volume' && n.parentId === null)
      if (vols.length > 0) {
        fallbackVolumeId = vols[vols.length - 1].id ?? null
        fallbackChildRef.value = existingNodes.filter(n => n.parentId === fallbackVolumeId).length
      } else {
        const adopted = yield* adoptScoped({
          projectId, worldGroupId: targetWorldGroupId,
          target: 'outlineNodes', mode: 'add',
          data: {
            parentId: null, type: 'volume', worldGroupId: targetWorldGroupId,
            title: '导入章节', summary: '',
            order: existingNodes.filter(n => n.parentId === null).length,
          },
        })
        fallbackVolumeId = adopted.written[0]?.id ?? null
        if (fallbackVolumeId != null) {
          existingNodes.push({
            id: fallbackVolumeId, projectId, parentId: null, type: 'volume',
            title: '导入章节', summary: '', order: 0, worldGroupId: targetWorldGroupId,
            createdAt: Date.now(), updatedAt: Date.now(),
          } as typeof existingNodes[number])
          outlineAdded++
        }
      }
    }

    // 顶层 order 接着已有大纲数量
    const startOrder = existingNodes
      .filter(n => n.parentId === null).length
    const ref = { value: startOrder }
    for (const n of result.outline) {
      const node = n as Record<string, unknown>
      if (!isVolumeNode(node) && fallbackVolumeId != null) {
        // 顶层章节 → 挂到卷下(不再成为孤儿)
        yield* writeNode(node, fallbackVolumeId, fallbackChildRef)
      } else {
        yield* writeNode(node, null, ref)
      }
    }
    if (guard) yield* inDexieScope(guard())
    if (!confirmedWrites) yield* inDexieScope(olStore.loadAll(scope))
  }

  return {
    worldviewFields,
    characters: charactersAdded,
    outlineNodes: outlineAdded,
    codexCandidates: result.codexCandidates?.length || 0,
  }
}
