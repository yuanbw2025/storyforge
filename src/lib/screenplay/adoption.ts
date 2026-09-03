import { db } from '../db/schema'
import type { ScreenplayBlock, ScreenplayCharacterExtension, ScreenplayScene, WorkspaceScope } from '../types'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { hashCanonicalValue } from '../agent/run/hash'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertValidScreenplaySceneV1 } from './contracts'

export type ScreenplayBlockCandidateV1 =
  | { id: string; type: 'action' | 'parenthetical' | 'dialogue' | 'transition' | 'shot' | 'note'; text: string }
  | { id: string; type: 'character'; characterResourceKey?: string; name: string; extension?: ScreenplayCharacterExtension; dualDialogue?: boolean }

export interface ScreenplaySceneCandidateV1 {
  stableKey: string
  planSectionKey: string
  episodeNumber: number
  sceneNumber: number
  intExt: ScreenplayScene['intExt']
  location: string
  timeOfDay: string
  summary: string
  estimatedSeconds: number
  sourceUnitKeys: string[]
  blocks: ScreenplayBlockCandidateV1[]
}

export interface ScreenplayCastResourceV1 {
  resourceKey: string
  characterId: number
  name: string
}

function assertCandidateClosed(value: ScreenplaySceneCandidateV1): void {
  const forbidden = new Set(['projectId', 'worldId', 'workId', 'adaptationProjectId', 'sourceUnitIds', 'sourceReviewManifestVersion', 'revision', 'status', 'createdAt', 'updatedAt', 'characterId'])
  const visit = (item: unknown, path: string) => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${path}[${index}]`))
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`[screenplay-adoption] 候选不得写系统字段 ${path}.${key}`)
      visit(child, `${path}.${key}`)
    }
  }
  visit(value, 'scene')
}

export async function adoptScreenplaySceneBatchV1(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  expectedPlanHash: string
  candidates: ScreenplaySceneCandidateV1[]
  castResources?: ScreenplayCastResourceV1[]
  allowReplaceReviewed?: boolean
}): Promise<ScreenplayScene[]> {
  if (!input.candidates.length || input.candidates.length > 10) throw new Error('[screenplay-adoption] 每批必须包含 1～10 场')
  input.candidates.forEach(assertCandidateClosed)
  if (new Set(input.candidates.map(scene => scene.stableKey)).size !== input.candidates.length) throw new Error('[screenplay-adoption] 候选 stableKey 重复')
  const scope = await resolveScope({ scope: input.scope })
  const rootBefore = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!rootBefore || rootBefore.medium !== 'screenplay' || rootBefore.workId !== scope.workId || rootBefore.projectId !== scope.projectId || rootBefore.worldId !== scope.worldId) throw new Error('[screenplay-adoption] 改编项目越界或媒介不匹配')
  if (rootBefore.revision !== input.expectedAdaptationRevision || rootBefore.activeSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[screenplay-adoption] 改编根或来源版本已变化')
  if (!rootBefore.plan || rootBefore.planSourceManifestVersion !== input.sourceManifestVersion || await hashCanonicalValue(rootBefore.plan) !== input.expectedPlanHash) throw new Error('[screenplay-adoption] 已确认计划已变化')
  const freshness = await inspectAdaptationFreshness(rootBefore.id!)
  if (freshness.status !== 'unchanged') throw new Error('[screenplay-adoption] 来源已变化或缺失，候选已 stale')
  const castResources = input.castResources ?? []
  if (new Set(castResources.map(item => item.resourceKey)).size !== castResources.length) throw new Error('[screenplay-adoption] cast resource key 重复')

  return db.transaction('rw', scopeTransactionTables(db.screenplayScenes, db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings, db.characters), async () => {
    const root = await db.adaptationProjects.get(input.adaptationProjectId)
    if (!root || root.revision !== input.expectedAdaptationRevision || root.activeSourceManifestVersion !== input.sourceManifestVersion || JSON.stringify(root.plan) !== JSON.stringify(rootBefore.plan)) throw new Error('[screenplay-adoption] CAS 失败：改编根或计划已变化')
    const [sourceUnits, bindings, existing] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id!, input.sourceManifestVersion]).toArray(),
      db.workCharacterBindings.where('workId').equals(root.workId).toArray(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id!).toArray(),
    ])
    const sourceByKey = new Map(sourceUnits.map(unit => [unit.sourceUnitKey, unit]))
    const boundIds = new Set(bindings.map(binding => binding.characterId))
    const castByKey = new Map(castResources.map(item => [item.resourceKey, item]))
    for (const resource of castResources) {
      const character = await db.characters.get(resource.characterId)
      if (!character || character.projectId !== scope.projectId || !boundIds.has(resource.characterId)) throw new Error(`[screenplay-adoption] cast resource 未绑定目标 Work：${resource.resourceKey}`)
    }
    const existingByKey = new Map(existing.map(scene => [scene.stableKey, scene]))
    const replacingIds = new Set(input.candidates.flatMap(candidate => {
      const row = existingByKey.get(candidate.stableKey)
      return row?.id == null ? [] : [row.id]
    }))
    const occupiedNumbers = new Set(existing.filter(scene => !replacingIds.has(scene.id!)).map(scene => `${scene.episodeNumber}:${scene.sceneNumber}`))
    const batchNumbers = new Set<string>()
    const now = Date.now()
    const nextRows: ScreenplayScene[] = []
    for (const [index, candidate] of input.candidates.entries()) {
      const previous = existingByKey.get(candidate.stableKey)
      if (previous?.status === 'locked') throw new Error(`[screenplay-adoption] 锁定场景不能覆盖：${candidate.stableKey}`)
      if (previous?.status === 'reviewed' && !input.allowReplaceReviewed) throw new Error(`[screenplay-adoption] 已审场景需作者显式允许覆盖：${candidate.stableKey}`)
      const numberKey = `${candidate.episodeNumber}:${candidate.sceneNumber}`
      if (occupiedNumbers.has(numberKey) || batchNumbers.has(numberKey)) throw new Error(`[screenplay-adoption] 场景号冲突：${numberKey}`)
      batchNumbers.add(numberKey)
      const sourceUnitIds = candidate.sourceUnitKeys.map(key => {
        const unit = sourceByKey.get(key)
        if (!unit?.id) throw new Error(`[screenplay-adoption] 来源 key 不属于冻结 manifest：${key}`)
        return unit.id
      })
      if (!sourceUnitIds.length || new Set(sourceUnitIds).size !== sourceUnitIds.length) throw new Error(`[screenplay-adoption] 场景来源为空或重复：${candidate.stableKey}`)
      const blocks: ScreenplayBlock[] = candidate.blocks.map(block => {
        if (block.type !== 'character') return structuredClone(block)
        const resource = block.characterResourceKey ? castByKey.get(block.characterResourceKey) : undefined
        if (block.characterResourceKey && !resource) throw new Error(`[screenplay-adoption] 未知 cast resource：${block.characterResourceKey}`)
        return {
          id: block.id,
          type: 'character',
          characterId: resource?.characterId ?? null,
          name: resource?.name ?? block.name,
          ...(block.extension ? { extension: block.extension } : {}),
          ...(block.dualDialogue ? { dualDialogue: true } : {}),
        }
      })
      const row: ScreenplayScene = stampNewRecord(scope, 'screenplayScenes', {
        ...(previous ?? {}),
        projectId: scope.projectId,
        workId: scope.workId,
        adaptationProjectId: root.id!,
        stableKey: candidate.stableKey,
        planSectionKey: candidate.planSectionKey,
        episodeNumber: candidate.episodeNumber,
        sceneNumber: candidate.sceneNumber,
        order: previous?.order ?? existing.length + index,
        intExt: candidate.intExt,
        location: candidate.location.trim(),
        timeOfDay: candidate.timeOfDay.trim(),
        summary: candidate.summary.trim(),
        estimatedSeconds: candidate.estimatedSeconds,
        sourceUnitIds,
        sourceReviewManifestVersion: input.sourceManifestVersion,
        blocks,
        status: 'draft',
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }, { owner: 'work' })
      assertValidScreenplaySceneV1({ scene: row, adaptation: root, sourceUnitIds: new Set(sourceUnits.map(unit => unit.id!)), bindings })
      nextRows.push(row)
    }
    await db.screenplayScenes.bulkPut(nextRows)
    return nextRows
  })
}
