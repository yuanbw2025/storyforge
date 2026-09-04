import { nanoid } from 'nanoid'
import { db } from '../db/schema'
import type { AdaptationProject, ScreenplayBlock, ScreenplayScene, ScreenplaySceneStatus, WorkspaceScope } from '../types'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { effectiveWorkKind } from '../workspace/work-kind'
import { assertValidScreenplaySceneV1 } from './contracts'

export interface ScreenplaySceneDraftV1 {
  stableKey?: string
  planSectionKey: string
  episodeNumber: number
  sceneNumber: number
  order?: number
  intExt: ScreenplayScene['intExt']
  location: string
  timeOfDay: string
  summary: string
  estimatedSeconds: number
  sourceUnitIds: number[]
  blocks: ScreenplayBlock[]
  status?: ScreenplaySceneStatus
}

async function requireScreenplay(scopeInput: WorkspaceScope, requireEditable = false): Promise<{ scope: WorkspaceScope; adaptation: AdaptationProject }> {
  const scope = await resolveScope({ scope: scopeInput })
  const [work, adaptation] = await Promise.all([
    db.works.get(scope.workId),
    db.adaptationProjects.where('workId').equals(scope.workId).first(),
  ])
  if (!work || effectiveWorkKind(work) !== 'screenplay' || !adaptation || adaptation.medium !== 'screenplay') throw new Error('[screenplay] 当前 Work 不是有效剧本改编')
  if (adaptation.projectId !== scope.projectId || adaptation.worldId !== scope.worldId) throw new Error('[screenplay] 改编根越过当前 scope')
  if (requireEditable && adaptation.status === 'complete') throw new Error('[screenplay] 剧本已正式完稿；请先重新打开审校')
  return { scope, adaptation }
}

async function validationDependencies(adaptation: AdaptationProject, manifestVersion: number) {
  const [units, bindings] = await Promise.all([
    db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([adaptation.id!, manifestVersion]).toArray(),
    db.workCharacterBindings.where('workId').equals(adaptation.workId).toArray(),
  ])
  return { sourceUnitIds: new Set(units.flatMap(unit => unit.id == null ? [] : [unit.id])), bindings }
}

export async function listScreenplayScenes(scopeInput: WorkspaceScope): Promise<ScreenplayScene[]> {
  const { scope, adaptation } = await requireScreenplay(scopeInput)
  const rows = await db.screenplayScenes.where('adaptationProjectId').equals(adaptation.id!).sortBy('order')
  return rows.filter(row => row.projectId === scope.projectId && row.workId === scope.workId)
}

export async function createScreenplayScene(scopeInput: WorkspaceScope, draft: ScreenplaySceneDraftV1): Promise<ScreenplayScene> {
  const { scope, adaptation } = await requireScreenplay(scopeInput, true)
  const freshness = await inspectAdaptationFreshness(adaptation.id!)
  if (freshness.status !== 'unchanged') throw new Error('[screenplay] 来源已变化或缺失；可编辑旧场景，但不能创建新正式场景')
  if (!['producing', 'review'].includes(adaptation.status)) throw new Error('[screenplay] 请先确认 Brief/Plan 并开始剧本生产')
  const deps = await validationDependencies(adaptation, adaptation.activeSourceManifestVersion)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.screenplayScenes, db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings), async () => {
    const current = await db.adaptationProjects.get(adaptation.id!)
    if (!current || current.revision !== adaptation.revision || current.activeSourceManifestHash !== adaptation.activeSourceManifestHash) throw new Error('[screenplay] 改编计划已变化，请刷新')
    const existing = await db.screenplayScenes.where('adaptationProjectId').equals(adaptation.id!).toArray()
    const scene: ScreenplayScene = stampNewRecord(scope, 'screenplayScenes', {
      projectId: scope.projectId,
      workId: scope.workId,
      adaptationProjectId: adaptation.id!,
      stableKey: draft.stableKey ?? `scene_${nanoid(16)}`,
      planSectionKey: draft.planSectionKey,
      episodeNumber: draft.episodeNumber,
      sceneNumber: draft.sceneNumber,
      order: draft.order ?? existing.length,
      intExt: draft.intExt,
      location: draft.location.trim(),
      timeOfDay: draft.timeOfDay.trim(),
      summary: draft.summary.trim(),
      estimatedSeconds: draft.estimatedSeconds,
      sourceUnitIds: [...draft.sourceUnitIds],
      sourceReviewManifestVersion: adaptation.activeSourceManifestVersion,
      blocks: structuredClone(draft.blocks),
      status: draft.status ?? (draft.blocks.length ? 'draft' : 'card'),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' })
    assertValidScreenplaySceneV1({ scene, adaptation: current, ...deps })
    if (existing.some(row => row.stableKey === scene.stableKey)) throw new Error('[screenplay] 场景 stableKey 重复')
    if (existing.some(row => row.episodeNumber === scene.episodeNumber && row.sceneNumber === scene.sceneNumber)) throw new Error('[screenplay] 同集场景号重复')
    const id = await db.screenplayScenes.add(scene) as number
    return { ...scene, id }
  })
}

export async function updateScreenplayScene(input: {
  scope: WorkspaceScope
  sceneId: number
  expectedRevision: number
  patch: Partial<Pick<ScreenplayScene, 'planSectionKey' | 'episodeNumber' | 'sceneNumber' | 'intExt' | 'location' | 'timeOfDay' | 'summary' | 'estimatedSeconds' | 'sourceUnitIds' | 'blocks' | 'status'>>
}): Promise<ScreenplayScene> {
  const { scope, adaptation } = await requireScreenplay(input.scope, true)
  return db.transaction('rw', scopeTransactionTables(db.screenplayScenes, db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings), async () => {
    const scene = await db.screenplayScenes.get(input.sceneId)
    if (!scene || !await assertRecordInScope(scope, 'screenplayScenes', scene, { owner: 'work' }) || scene.adaptationProjectId !== adaptation.id) throw new Error('[screenplay] 场景不存在或越界')
    if (scene.revision !== input.expectedRevision) throw new Error('[screenplay] 场景已变化，请刷新')
    if (scene.status === 'locked' && input.patch.status !== 'draft') throw new Error('[screenplay] 锁定场景必须先解锁')
    const next: ScreenplayScene = {
      ...scene,
      ...structuredClone(input.patch),
      location: input.patch.location?.trim() ?? scene.location,
      timeOfDay: input.patch.timeOfDay?.trim() ?? scene.timeOfDay,
      summary: input.patch.summary?.trim() ?? scene.summary,
      revision: scene.revision + 1,
      updatedAt: Date.now(),
    }
    const deps = await validationDependencies(adaptation, next.sourceReviewManifestVersion)
    assertValidScreenplaySceneV1({ scene: next, adaptation, ...deps })
    const collisions = await db.screenplayScenes.where('[adaptationProjectId+episodeNumber+sceneNumber]').equals([adaptation.id!, next.episodeNumber, next.sceneNumber]).toArray()
    if (collisions.some(row => row.id !== scene.id)) throw new Error('[screenplay] 同集场景号重复')
    await db.screenplayScenes.put(next)
    return next
  })
}

export async function setScreenplaySceneLocked(input: { scope: WorkspaceScope; sceneId: number; expectedRevision: number; locked: boolean }): Promise<ScreenplayScene> {
  return updateScreenplayScene({ scope: input.scope, sceneId: input.sceneId, expectedRevision: input.expectedRevision, patch: { status: input.locked ? 'locked' : 'draft' } })
}

export async function deleteScreenplayScene(input: { scope: WorkspaceScope; sceneId: number }): Promise<void> {
  const { scope, adaptation } = await requireScreenplay(input.scope, true)
  await db.transaction('rw', db.screenplayScenes, async () => {
    const scene = await db.screenplayScenes.get(input.sceneId)
    if (!scene || !await assertRecordInScope(scope, 'screenplayScenes', scene, { owner: 'work' }) || scene.adaptationProjectId !== adaptation.id) throw new Error('[screenplay] 场景不存在或越界')
    if (scene.status === 'locked') throw new Error('[screenplay] 锁定场景必须先解锁才能删除')
    await db.screenplayScenes.delete(scene.id!)
  })
}

export async function reorderScreenplayScenes(input: { scope: WorkspaceScope; orderedSceneIds: number[] }): Promise<ScreenplayScene[]> {
  const { adaptation } = await requireScreenplay(input.scope, true)
  if (new Set(input.orderedSceneIds).size !== input.orderedSceneIds.length) throw new Error('[screenplay] 排序包含重复场景')
  return db.transaction('rw', db.screenplayScenes, async () => {
    const rows = await db.screenplayScenes.where('adaptationProjectId').equals(adaptation.id!).toArray()
    if (rows.length !== input.orderedSceneIds.length || rows.some(row => !input.orderedSceneIds.includes(row.id!))) throw new Error('[screenplay] 排序必须覆盖全部场景')
    const byId = new Map(rows.map(row => [row.id!, row]))
    const now = Date.now()
    const ordered = input.orderedSceneIds.map((id, order) => ({ ...byId.get(id)!, order, revision: byId.get(id)!.revision + 1, updatedAt: now }))
    await db.screenplayScenes.bulkPut(ordered)
    return ordered
  })
}

export async function duplicateScreenplayScene(input: { scope: WorkspaceScope; sceneId: number }): Promise<ScreenplayScene> {
  const scenes = await listScreenplayScenes(input.scope)
  const scene = scenes.find(row => row.id === input.sceneId)
  if (!scene) throw new Error('[screenplay] 场景不存在或越界')
  const episodeScenes = scenes.filter(row => row.episodeNumber === scene.episodeNumber)
  return createScreenplayScene(input.scope, {
    ...scene,
    stableKey: undefined,
    sceneNumber: Math.max(0, ...episodeScenes.map(row => row.sceneNumber)) + 1,
    order: scenes.length,
    summary: `${scene.summary}（副本）`,
    blocks: scene.blocks.map(block => ({ ...block, id: `block_${nanoid(12)}` })),
    status: scene.status === 'locked' ? 'draft' : scene.status,
  })
}

export async function splitScreenplayScene(input: { scope: WorkspaceScope; sceneId: number; blockIndex: number; expectedRevision: number }): Promise<[ScreenplayScene, ScreenplayScene]> {
  const scenes = await listScreenplayScenes(input.scope)
  const scene = scenes.find(row => row.id === input.sceneId)
  if (!scene || scene.revision !== input.expectedRevision) throw new Error('[screenplay] 场景不存在或已变化')
  if (scene.status === 'locked') throw new Error('[screenplay] 锁定场景必须先解锁')
  if (!Number.isInteger(input.blockIndex) || input.blockIndex < 1 || input.blockIndex >= scene.blocks.length) throw new Error('[screenplay] 拆分位置非法')
  const first = await updateScreenplayScene({ scope: input.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { blocks: scene.blocks.slice(0, input.blockIndex), estimatedSeconds: Math.max(1, Math.round(scene.estimatedSeconds * input.blockIndex / scene.blocks.length)) } })
  const second = await createScreenplayScene(input.scope, {
    ...scene,
    stableKey: undefined,
    sceneNumber: Math.max(0, ...scenes.filter(row => row.episodeNumber === scene.episodeNumber).map(row => row.sceneNumber)) + 1,
    order: scenes.length,
    summary: `${scene.summary}（续）`,
    estimatedSeconds: Math.max(1, scene.estimatedSeconds - first.estimatedSeconds),
    blocks: scene.blocks.slice(input.blockIndex),
    status: 'draft',
  })
  return [first, second]
}

export async function mergeScreenplayScenes(input: { scope: WorkspaceScope; firstSceneId: number; secondSceneId: number; expectedFirstRevision: number; expectedSecondRevision: number }): Promise<ScreenplayScene> {
  const { adaptation } = await requireScreenplay(input.scope, true)
  return db.transaction('rw', scopeTransactionTables(db.screenplayScenes, db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings), async () => {
    const rows = await db.screenplayScenes.where('adaptationProjectId').equals(adaptation.id!).sortBy('order')
    const firstIndex = rows.findIndex(row => row.id === input.firstSceneId)
    const secondIndex = rows.findIndex(row => row.id === input.secondSceneId)
    if (firstIndex < 0 || secondIndex !== firstIndex + 1) throw new Error('[screenplay] 只能合并相邻场景')
    const first = rows[firstIndex]
    const second = rows[secondIndex]
    if (first.revision !== input.expectedFirstRevision || second.revision !== input.expectedSecondRevision) throw new Error('[screenplay] 待合并场景已变化')
    if (first.status === 'locked' || second.status === 'locked') throw new Error('[screenplay] 锁定场景必须先解锁')
    if (first.episodeNumber !== second.episodeNumber || first.planSectionKey !== second.planSectionKey) throw new Error('[screenplay] 只能合并同集、同计划段场景')
    const blockIds = new Set(first.blocks.map(block => block.id))
    const appendedBlocks = second.blocks.map(block => blockIds.has(block.id) ? { ...block, id: `block_${nanoid(12)}` } : block)
    const next: ScreenplayScene = {
      ...first,
      summary: [first.summary, second.summary].filter(Boolean).join('；'),
      estimatedSeconds: first.estimatedSeconds + second.estimatedSeconds,
      sourceUnitIds: [...new Set([...first.sourceUnitIds, ...second.sourceUnitIds])],
      sourceReviewManifestVersion: Math.min(first.sourceReviewManifestVersion, second.sourceReviewManifestVersion),
      blocks: [...first.blocks, ...appendedBlocks],
      status: 'draft',
      revision: first.revision + 1,
      updatedAt: Date.now(),
    }
    const deps = await validationDependencies(adaptation, next.sourceReviewManifestVersion)
    assertValidScreenplaySceneV1({ scene: next, adaptation, ...deps })
    await db.screenplayScenes.put(next)
    await db.screenplayScenes.delete(second.id!)
    const remaining = rows.filter(row => row.id !== second.id).map((row, order) => row.id === first.id ? { ...next, order } : { ...row, order })
    await db.screenplayScenes.bulkPut(remaining)
    return { ...next, order: firstIndex }
  })
}
