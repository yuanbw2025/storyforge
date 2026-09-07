import { db } from '../db/schema'
import type {
  AdaptationPlanV1,
  AdaptationProject,
  ScreenplayBeatCandidateV1,
  ScreenplayBeatV1,
  ScreenplayReviewCategoryV1,
  ScreenplayReviewIssueCandidateV1,
  ScreenplayReviewIssueV1,
  ScreenplayRewritePatchCandidateV1,
  ScreenplayScene,
  ScreenplaySceneCardCandidateV1,
  ScreenplaySceneCardV1,
  WorkspaceScope,
} from '../types'
import { inspectAdaptationFreshness, startAdaptationProduction } from '../adaptation/source-manifest'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertValidScreenplaySceneV1, validateScreenplayBlocksV1 } from './contracts'
import {
  assertCandidateBatchV1,
  assertScreenplayBeatCandidateV1,
  assertScreenplayReviewIssueCandidateV1,
  assertScreenplayRewritePatchCandidateV1,
  assertScreenplaySceneCardCandidateV1,
} from './production-contracts'

export interface ScreenplayProductionSnapshotV1 {
  beats: ScreenplayBeatV1[]
  sceneCards: ScreenplaySceneCardV1[]
  reviewIssues: ScreenplayReviewIssueV1[]
}

export interface ScreenplayCompletionReportV1 {
  ready: boolean
  blockers: string[]
  warnings: string[]
  totalEstimatedSeconds: number
  targetEstimatedSeconds: number
}

async function requireRoot(scopeInput: WorkspaceScope, expectedRevision?: number, editable = true): Promise<{ scope: WorkspaceScope; root: AdaptationProject & { id: number } }> {
  const scope = await resolveScope({ scope: scopeInput })
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.medium !== 'screenplay' || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[screenplay-production] 当前 Work 不是有效剧本改编')
  if (expectedRevision != null && root.revision !== expectedRevision) throw new Error('[screenplay-production] 改编根已变化，请刷新')
  if (editable && root.status === 'complete') throw new Error('[screenplay-production] 已发布剧本必须先重新打开审校')
  return { scope, root: root as AdaptationProject & { id: number } }
}

async function requireFresh(root: AdaptationProject & { id: number }): Promise<void> {
  if ((await inspectAdaptationFreshness(root.id)).status !== 'unchanged') throw new Error('[screenplay-production] 来源已变化或缺失，候选已 stale')
}

function assertRootCas(current: AdaptationProject | undefined, expected: AdaptationProject & { id: number }): asserts current is AdaptationProject & { id: number } {
  if (!current?.id || current.revision !== expected.revision
    || current.activeSourceManifestVersion !== expected.activeSourceManifestVersion
    || current.activeSourceManifestHash !== expected.activeSourceManifestHash) throw new Error('[screenplay-production] CAS 失败：改编根或来源版本已变化')
}

function targetSeconds(root: AdaptationProject): number {
  if (root.medium !== 'screenplay') return 0
  return Math.round(root.targetSpec.targetMinutesPerEpisode * 60 * (root.targetSpec.format === 'film' ? 1 : root.targetSpec.episodeCount ?? 1))
}

function assertEpisode(root: AdaptationProject, episode: number, label: string): void {
  if (root.medium !== 'screenplay') throw new Error('[screenplay-production] 媒介不是剧本')
  if (root.targetSpec.format === 'film' && episode !== 1) throw new Error(`[screenplay-production] ${label}：电影集号必须为 1`)
  if (root.targetSpec.episodeCount != null && episode > root.targetSpec.episodeCount) throw new Error(`[screenplay-production] ${label}：集号超过目标集数`)
}

function planFromBeats(root: AdaptationProject, beats: ScreenplayBeatV1[]): AdaptationPlanV1 {
  const grouped = new Map<string, ScreenplayBeatV1[]>()
  for (const beat of [...beats].sort((a, b) => a.order - b.order)) grouped.set(beat.sectionKey, [...(grouped.get(beat.sectionKey) ?? []), beat])
  return {
    version: 1,
    premise: root.brief?.coreTheme || beats[0]?.objective || '待完善的剧本前提',
    sections: [...grouped.entries()].map(([stableKey, rows], order) => {
      const first = rows[0]
      if (rows.some(row => row.sectionTitle !== first.sectionTitle || row.episodeNumber !== first.episodeNumber)) throw new Error(`[screenplay-production] 结构段 ${stableKey} 的标题或集号不一致`)
      return {
        stableKey,
        title: first.sectionTitle,
        summary: rows.map(row => `${row.objective} → ${row.turn}`).join('；'),
        order,
        episodeNumber: first.episodeNumber,
        sourceUnitKeys: [...new Set(rows.flatMap(row => row.sourceUnitKeys))],
      }
    }),
    globalAssumptions: root.plan?.globalAssumptions ?? [],
  }
}

export async function listScreenplayProductionV1(scopeInput: WorkspaceScope): Promise<ScreenplayProductionSnapshotV1> {
  const { root } = await requireRoot(scopeInput, undefined, false)
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [beats, sceneCards, reviewIssues] = await Promise.all([
    db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt'),
  ])
  return { beats, sceneCards, reviewIssues }
}

export async function adoptScreenplayBeatsV1(input: {
  scope: WorkspaceScope
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  candidates: ScreenplayBeatCandidateV1[]
  allowReplaceDownstream?: boolean
}): Promise<ScreenplayBeatV1[]> {
  assertCandidateBatchV1(input.candidates, assertScreenplayBeatCandidateV1, 'Beat', false, 500)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision)
  if (root.activeSourceManifestVersion !== input.sourceManifestVersion || root.briefSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[screenplay-production] 当前来源版本的 Brief 尚未确认')
  await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(
    db.adaptationProjects, db.adaptationSourceUnits, db.adaptationSourceFacts, db.adaptationDecisions,
    db.screenplayBeats, db.screenplaySceneCards, db.screenplayScenes, db.screenplayReviewIssues,
  ), async () => {
    const current = await db.adaptationProjects.get(root.id); assertRootCas(current, root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, facts, decisions, cards, scenes] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray(),
    ])
    if (!facts.some(row => row.authorStatus === 'confirmed')) throw new Error('[screenplay-production] 请先确认来源事实')
    if (!decisions.some(row => row.authorStatus === 'confirmed')) throw new Error('[screenplay-production] 请先确认改编决策')
    if ((cards.length || scenes.length) && !input.allowReplaceDownstream) throw new Error('[screenplay-production] 重做 Beat 会清除 Scene Card、场景与审查，必须显式确认')
    const unitKeys = new Set(units.map(row => row.sourceUnitKey))
    const factKeys = new Set(facts.filter(row => row.authorStatus === 'confirmed').map(row => row.stableKey))
    const decisionKeys = new Set(decisions.filter(row => row.authorStatus === 'confirmed').map(row => row.stableKey))
    const now = Date.now()
    const rows = input.candidates.map(candidate => {
      assertEpisode(root, candidate.episodeNumber, candidate.stableKey)
      if (candidate.sourceUnitKeys.some(key => !unitKeys.has(key))) throw new Error(`[screenplay-production] Beat ${candidate.stableKey} 引用未知来源`)
      if (candidate.causalFactKeys.some(key => !factKeys.has(key))) throw new Error(`[screenplay-production] Beat ${candidate.stableKey} 引用未确认事实`)
      if (candidate.decisionKeys.some(key => !decisionKeys.has(key))) throw new Error(`[screenplay-production] Beat ${candidate.stableKey} 引用未确认决策`)
      return stampNewRecord(scope, 'screenplayBeats', {
        ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id,
        manifestVersion: input.sourceManifestVersion, authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now,
      }, { owner: 'work' }) as ScreenplayBeatV1
    })
    const plan = planFromBeats(root, rows)
    await Promise.all([
      db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
      db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id).delete(),
      db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
    ])
    await db.screenplayBeats.bulkAdd(rows)
    await db.adaptationProjects.update(root.id, { plan, planSourceManifestVersion: input.sourceManifestVersion, status: 'planning', revision: root.revision + 1, updatedAt: now })
    return db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
}

export async function adoptScreenplaySceneCardsV1(input: {
  scope: WorkspaceScope
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  candidates: ScreenplaySceneCardCandidateV1[]
  allowReplaceDownstream?: boolean
}): Promise<ScreenplaySceneCardV1[]> {
  assertCandidateBatchV1(input.candidates, assertScreenplaySceneCardCandidateV1, 'SceneCard', false, 2_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision)
  if (root.activeSourceManifestVersion !== input.sourceManifestVersion || root.planSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[screenplay-production] 当前 Beat 尚未确认')
  await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.screenplayBeats, db.screenplaySceneCards, db.screenplayScenes, db.screenplayReviewIssues), async () => {
    const current = await db.adaptationProjects.get(root.id); assertRootCas(current, root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, beats, scenes] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray(),
    ])
    if (!beats.length) throw new Error('[screenplay-production] 请先确认 Beat Sheet')
    if (scenes.length && !input.allowReplaceDownstream) throw new Error('[screenplay-production] 重做 Scene Card 会清除场景与审查，必须显式确认')
    const unitKeys = new Set(units.map(row => row.sourceUnitKey)); const beatByKey = new Map(beats.map(row => [row.stableKey, row]))
    const numberKeys = new Set<string>(); const now = Date.now()
    const rows = input.candidates.map(candidate => {
      const beat = beatByKey.get(candidate.beatKey)
      if (!beat || beat.episodeNumber !== candidate.episodeNumber) throw new Error(`[screenplay-production] Scene Card ${candidate.stableKey} 的 Beat 不存在或集号不一致`)
      const numberKey = `${candidate.episodeNumber}:${candidate.sceneNumber}`
      if (numberKeys.has(numberKey)) throw new Error(`[screenplay-production] Scene Card 场号重复：${numberKey}`)
      numberKeys.add(numberKey); assertEpisode(root, candidate.episodeNumber, candidate.stableKey)
      if (candidate.sourceUnitKeys.some(key => !unitKeys.has(key))) throw new Error(`[screenplay-production] Scene Card ${candidate.stableKey} 引用未知来源`)
      return stampNewRecord(scope, 'screenplaySceneCards', {
        ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id,
        manifestVersion: input.sourceManifestVersion, authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now,
      }, { owner: 'work' }) as ScreenplaySceneCardV1
    })
    const covered = new Set(rows.map(row => row.beatKey)); const missing = beats.filter(beat => !covered.has(beat.stableKey))
    if (missing.length) throw new Error(`[screenplay-production] 每个 Beat 至少需要一张 Scene Card：${missing.map(row => row.stableKey).join('、')}`)
    await Promise.all([
      db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id).delete(),
      db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
    ])
    await db.screenplaySceneCards.bulkAdd(rows)
    await db.adaptationProjects.update(root.id, { revision: root.revision + 1, updatedAt: now })
    return db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
}

export async function startScreenplayProductionV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number }): Promise<AdaptationProject> {
  const { root } = await requireRoot(input.scope, input.expectedAdaptationRevision)
  const snapshot = await listScreenplayProductionV1(input.scope)
  if (!snapshot.beats.length || !snapshot.sceneCards.length) throw new Error('[screenplay-production] 必须先确认 Beat Sheet 与 Scene Cards')
  return startAdaptationProduction({ adaptationProjectId: root.id, expectedRevision: root.revision })
}

export async function assertSceneCandidateMatchesCardV1(scope: WorkspaceScope, candidate: {
  stableKey: string; planSectionKey: string; episodeNumber: number; sceneNumber: number; estimatedSeconds: number; sourceUnitKeys: string[]
}): Promise<void> {
  const { root } = await requireRoot(scope)
  const [card, beat] = await Promise.all([
    db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals([root.id, root.activeSourceManifestVersion]).filter(row => row.stableKey === candidate.stableKey).first(),
    db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals([root.id, root.activeSourceManifestVersion]).toArray(),
  ])
  const linkedBeat = card ? beat.find(row => row.stableKey === card.beatKey) : undefined
  if (!card || !linkedBeat) throw new Error(`[screenplay-production] 场景 ${candidate.stableKey} 没有已确认 Scene Card`)
  if (candidate.planSectionKey !== linkedBeat.sectionKey || candidate.episodeNumber !== card.episodeNumber || candidate.sceneNumber !== card.sceneNumber) throw new Error(`[screenplay-production] 场景 ${candidate.stableKey} 偏离 Scene Card 身份`)
  if (candidate.sourceUnitKeys.some(key => !card.sourceUnitKeys.includes(key))) throw new Error(`[screenplay-production] 场景 ${candidate.stableKey} 引用了 Scene Card 之外的来源`)
}

export async function adoptScreenplayReviewIssuesV1(input: {
  scope: WorkspaceScope
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  category: ScreenplayReviewCategoryV1
  targetSceneKeys: string[]
  expectedSceneRevisions: Record<string, number>
  candidates: ScreenplayReviewIssueCandidateV1[]
}): Promise<ScreenplayReviewIssueV1[]> {
  assertCandidateBatchV1(input.candidates, value => assertScreenplayReviewIssueCandidateV1(value, input.category), 'ReviewIssue', true, 1_000)
  if (!input.targetSceneKeys.length || new Set(input.targetSceneKeys).size !== input.targetSceneKeys.length) throw new Error('[screenplay-production] 审查目标场景为空或重复')
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  if (root.activeSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[screenplay-production] 审查来源版本已变化')
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.screenplayScenes, db.screenplayReviewIssues), async () => {
    const current = await db.adaptationProjects.get(root.id); assertRootCas(current, root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, scenes] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray(),
    ])
    const unitKeys = new Set(units.map(row => row.sourceUnitKey)); const sceneByKey = new Map(scenes.map(row => [row.stableKey, row]))
    for (const sceneKey of input.targetSceneKeys) {
      const scene = sceneByKey.get(sceneKey)
      if (!scene || scene.revision !== input.expectedSceneRevisions[sceneKey]) throw new Error(`[screenplay-production] 审查目标 ${sceneKey} 已变化`)
    }
    const now = Date.now()
    const rows = input.candidates.map(candidate => {
      const scene = sceneByKey.get(candidate.sceneKey)
      if (!scene || !input.targetSceneKeys.includes(candidate.sceneKey)) throw new Error(`[screenplay-production] ReviewIssue ${candidate.stableKey} 越过审查目标`)
      if (candidate.blockId && !scene.blocks.some(block => block.id === candidate.blockId)) throw new Error(`[screenplay-production] ReviewIssue ${candidate.stableKey} 引用未知 block`)
      if (candidate.sourceUnitKeys.some(sourceKey => !unitKeys.has(sourceKey))) throw new Error(`[screenplay-production] ReviewIssue ${candidate.stableKey} 引用未知来源`)
      return stampNewRecord(scope, 'screenplayReviewIssues', {
        ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id,
        manifestVersion: input.sourceManifestVersion, reviewedSceneRevision: scene.revision, status: 'open' as const, createdAt: now, updatedAt: now,
      }, { owner: 'work' }) as ScreenplayReviewIssueV1
    })
    const existing = await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
    const candidateKeys = new Set(rows.map(row => row.stableKey))
    await db.screenplayReviewIssues.bulkDelete(existing.filter(row => row.category === input.category
      && input.targetSceneKeys.includes(row.sceneKey)
      && (row.status === 'open' || candidateKeys.has(row.stableKey))).flatMap(row => row.id == null ? [] : [row.id]))
    if (rows.length) await db.screenplayReviewIssues.bulkAdd(rows)
    if (input.category === 'grounding' || input.category === 'dramaturgy') {
      const reviewField = input.category === 'grounding' ? 'groundingReviewRevision' : 'dramaturgyReviewRevision'
      await db.screenplayScenes.bulkPut(input.targetSceneKeys.map(sceneKey => {
        const scene = sceneByKey.get(sceneKey)!
        return { ...scene, [reviewField]: scene.revision, updatedAt: now }
      }))
    }
    await db.adaptationProjects.update(root.id, { status: 'review', revision: root.revision + 1, updatedAt: now })
    return db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt')
  })
}

export async function applyScreenplayRewriteV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; candidate: ScreenplayRewritePatchCandidateV1 }): Promise<ScreenplayScene> {
  assertScreenplayRewritePatchCandidateV1(input.candidate)
  const { root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings, db.screenplayScenes, db.screenplayReviewIssues), async () => {
    const current = await db.adaptationProjects.get(root.id); assertRootCas(current, root)
    const scene = await db.screenplayScenes.where('adaptationProjectId').equals(root.id).filter(row => row.stableKey === input.candidate.sceneKey).first()
    if (!scene || scene.revision !== input.candidate.expectedSceneRevision) throw new Error('[screenplay-production] 定点改写目标场景已变化')
    if (scene.status === 'locked') throw new Error('[screenplay-production] 锁定场景必须先解锁')
    const issues = await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals([root.id, root.activeSourceManifestVersion]).toArray()
    const selected = input.candidate.issueKeys.map(issueKey => issues.find(row => row.stableKey === issueKey))
    if (selected.some(issue => !issue || issue.sceneKey !== scene.stableKey || issue.status !== 'open' || issue.reviewedSceneRevision !== scene.revision)) throw new Error('[screenplay-production] 定点改写只能处理该场当前版本的开放问题')
    const next: ScreenplayScene = { ...scene, summary: input.candidate.summary.trim(), blocks: structuredClone(input.candidate.blocks), status: 'draft', revision: scene.revision + 1, updatedAt: Date.now() }
    const [units, bindings] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id, scene.sourceReviewManifestVersion]).toArray(),
      db.workCharacterBindings.where('workId').equals(root.workId).toArray(),
    ])
    assertValidScreenplaySceneV1({ scene: next, adaptation: root, sourceUnitIds: new Set(units.map(row => row.id!)), bindings })
    await db.screenplayScenes.put(next)
    const now = Date.now()
    await db.screenplayReviewIssues.bulkPut((selected as ScreenplayReviewIssueV1[]).map(issue => ({ ...issue, status: 'resolved' as const, updatedAt: now })))
    return next
  })
}

export async function updateScreenplayReviewIssueStatusV1(input: { scope: WorkspaceScope; issueId: number; status: 'resolved' | 'dismissed' }): Promise<ScreenplayReviewIssueV1> {
  const { root } = await requireRoot(input.scope)
  return db.transaction('rw', db.screenplayReviewIssues, async () => {
    const issue = await db.screenplayReviewIssues.get(input.issueId)
    if (!issue || issue.adaptationProjectId !== root.id || issue.workId !== root.workId) throw new Error('[screenplay-production] 审查问题不存在或越界')
    const next = { ...issue, status: input.status, updatedAt: Date.now() }
    await db.screenplayReviewIssues.put(next)
    return next
  })
}

export async function inspectScreenplayCompletionV1(scopeInput: WorkspaceScope): Promise<ScreenplayCompletionReportV1> {
  const { root } = await requireRoot(scopeInput, undefined, false)
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [facts, decisions, beats, cards, scenes, issues, units, bindings] = await Promise.all([
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplayScenes.where('adaptationProjectId').equals(root.id).sortBy('order'),
    db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.workCharacterBindings.where('workId').equals(root.workId).toArray(),
  ])
  const blockers: string[] = []; const warnings: string[] = []
  if (root.briefSourceManifestVersion !== root.activeSourceManifestVersion) blockers.push('改编 Brief 尚未按当前来源确认。')
  if (!facts.some(row => row.authorStatus === 'confirmed')) blockers.push('缺少作者确认的来源事实。')
  if (!decisions.some(row => row.authorStatus === 'confirmed')) blockers.push('缺少作者确认的改编决定。')
  if (!beats.length) blockers.push('Beat Sheet 为空。')
  if (!cards.length) blockers.push('Scene Cards 为空。')
  const sceneByKey = new Map(scenes.map(scene => [scene.stableKey, scene]))
  const cardByKey = new Map(cards.map(card => [card.stableKey, card]))
  const beatByKey = new Map(beats.map(beat => [beat.stableKey, beat]))
  const unitKeyById = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.id, unit.sourceUnitKey] as const]))
  for (const card of cards) if (!sceneByKey.has(card.stableKey)) blockers.push(`Scene Card ${card.stableKey} 尚未写成场景。`)
  const unitIds = new Set(units.map(row => row.id!))
  for (const scene of scenes) {
    const card = cardByKey.get(scene.stableKey)
    const beat = card ? beatByKey.get(card.beatKey) : undefined
    if (!card || !beat) blockers.push(`场景 ${scene.stableKey} 没有当前版本的 Scene Card。`)
    else {
      if (scene.planSectionKey !== beat.sectionKey || scene.episodeNumber !== card.episodeNumber || scene.sceneNumber !== card.sceneNumber) blockers.push(`场景 ${scene.stableKey} 偏离 Scene Card 身份。`)
      const sourceKeys = scene.sourceUnitIds.map(id => unitKeyById.get(id))
      if (sourceKeys.some(key => !key || !card.sourceUnitKeys.includes(key))) blockers.push(`场景 ${scene.stableKey} 引用了 Scene Card 之外的来源。`)
    }
    const report = validateScreenplayBlocksV1(scene.blocks)
    if (!report.valid) blockers.push(`场景 ${scene.stableKey} 格式不合法。`)
    try { assertValidScreenplaySceneV1({ scene, adaptation: root, sourceUnitIds: unitIds, bindings }) } catch (error) { blockers.push(error instanceof Error ? error.message : `场景 ${scene.stableKey} 非法`) }
    if (!['reviewed', 'locked'].includes(scene.status)) blockers.push(`场景 ${scene.stableKey} 尚未审定。`)
    if (scene.sourceReviewManifestVersion !== root.activeSourceManifestVersion) blockers.push(`场景 ${scene.stableKey} 来源审查版本已过期。`)
    if (scene.groundingReviewRevision !== scene.revision) blockers.push(`场景 ${scene.stableKey} 尚未按当前内容完成来源审查。`)
    if (scene.dramaturgyReviewRevision !== scene.revision) blockers.push(`场景 ${scene.stableKey} 尚未按当前内容完成戏剧审查。`)
  }
  const open = issues.filter(issue => issue.status === 'open')
  if (open.some(issue => issue.severity === 'critical' || issue.severity === 'major')) blockers.push('仍有开放的 critical/major 审查问题。')
  if (open.some(issue => sceneByKey.get(issue.sceneKey)?.revision !== issue.reviewedSceneRevision)) blockers.push('存在基于旧场景版本的开放审查问题，请重新审查。')
  const totalEstimatedSeconds = scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0)
  const targetEstimatedSeconds = targetSeconds(root)
  const drift = targetEstimatedSeconds ? Math.abs(totalEstimatedSeconds - targetEstimatedSeconds) / targetEstimatedSeconds : 1
  if (drift > 0.35) blockers.push('剧本预计时长偏离目标超过 35%。')
  else if (drift > 0.15) warnings.push('剧本预计时长偏离目标超过 15%。')
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], totalEstimatedSeconds, targetEstimatedSeconds }
}
