import { db } from '../db/schema'
import type {
  AdaptationAuthorStatusV1,
  AdaptationCausalEdgeV1,
  AdaptationDecisionV1,
  AdaptationProject,
  AdaptationSourceFactV1,
  WorkspaceScope,
} from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import {
  assertAdaptationCausalEdgeV1,
  assertAdaptationDecisionV1,
  assertAdaptationSourceFactV1,
} from './contracts'
import { inspectAdaptationFreshness } from './source-manifest'

export type AdaptationSourceFactCandidateV1 = Pick<
  AdaptationSourceFactV1,
  'stableKey' | 'kind' | 'statement' | 'subjectKeys' | 'sourceUnitKeys' | 'confidence'
>

export type AdaptationCausalEdgeCandidateV1 = Pick<
  AdaptationCausalEdgeV1,
  'stableKey' | 'fromFactKey' | 'toFactKey' | 'relation' | 'rationale' | 'sourceUnitKeys'
>

export type AdaptationDecisionCandidateV1 = Pick<
  AdaptationDecisionV1,
  'stableKey' | 'action' | 'sourceFactKeys' | 'targetKeys' | 'rationale'
>

export interface ReviewedAdaptationCandidateV1<T> {
  candidate: T
  /** Supplied by the review UI, never parsed from model output. */
  authorStatus: AdaptationAuthorStatusV1
}

interface AnalysisAdoptionInput<T> {
  scope: WorkspaceScope
  adaptationProjectId: number
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  items: ReviewedAdaptationCandidateV1<T>[]
}

function assertCandidateShape(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[adaptation-analysis] ${label} 候选必须是对象`)
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  const missing = allowed.filter(key => !(key in value))
  if (unknown.length) throw new Error(`[adaptation-analysis] ${label} 候选含系统或未知字段：${unknown.join('、')}`)
  if (missing.length) throw new Error(`[adaptation-analysis] ${label} 候选缺少字段：${missing.join('、')}`)
}

function assertReviewedBatch<T extends { stableKey: string }>(items: ReviewedAdaptationCandidateV1<T>[]): void {
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) throw new Error('[adaptation-analysis] 每批必须包含 1～500 个审定项')
  for (const item of items) {
    if (!item || !item.candidate || (item.authorStatus !== 'confirmed' && item.authorStatus !== 'rejected')) throw new Error('[adaptation-analysis] 缺少作者审定状态或候选')
  }
  if (new Set(items.map(item => item.candidate.stableKey)).size !== items.length) throw new Error('[adaptation-analysis] 批次 stableKey 重复')
}

async function requireWritableAnalysis<T extends { stableKey: string }>(input: AnalysisAdoptionInput<T>): Promise<{
  scope: WorkspaceScope
  root: AdaptationProject
}> {
  const scope = await resolveScope({ scope: input.scope })
  const root = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!root || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) {
    throw new Error('[adaptation-analysis] 改编项目不属于当前目标 Work')
  }
  if (root.revision !== input.expectedAdaptationRevision || root.activeSourceManifestVersion !== input.sourceManifestVersion) {
    throw new Error('[adaptation-analysis] 改编根或来源版本已变化，请刷新')
  }
  if (root.status === 'complete') throw new Error('[adaptation-analysis] 已完成改编必须先重新打开审校')
  const freshness = await inspectAdaptationFreshness(root.id!)
  if (freshness.status !== 'unchanged') throw new Error('[adaptation-analysis] 来源已变化或缺失，候选已 stale')
  return { scope, root }
}

function assertCurrentRoot(current: AdaptationProject | undefined, expected: AdaptationProject): asserts current is AdaptationProject {
  if (!current
    || current.revision !== expected.revision
    || current.activeSourceManifestVersion !== expected.activeSourceManifestVersion
    || current.activeSourceManifestHash !== expected.activeSourceManifestHash) {
    throw new Error('[adaptation-analysis] CAS 失败：改编根或来源清单已变化')
  }
}

function assertKnownSourceUnits(sourceUnitKeys: readonly string[], known: ReadonlySet<string>, label: string): void {
  const unknown = sourceUnitKeys.filter(key => !known.has(key))
  if (unknown.length) throw new Error(`[adaptation-analysis] ${label} 引用了未知来源单元：${unknown.join('、')}`)
}

export async function adoptAdaptationSourceFactsV1(
  input: AnalysisAdoptionInput<AdaptationSourceFactCandidateV1>,
): Promise<AdaptationSourceFactV1[]> {
  assertReviewedBatch(input.items)
  input.items.forEach(({ candidate }) => assertCandidateShape(candidate, ['stableKey', 'kind', 'statement', 'subjectKeys', 'sourceUnitKeys', 'confidence'], '来源事实'))
  const { scope, root } = await requireWritableAnalysis(input)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.adaptationProjects,
    db.adaptationSourceUnits,
    db.adaptationSourceFacts,
    db.adaptationCausalEdges,
    db.adaptationDecisions,
  ), async () => {
    const current = await db.adaptationProjects.get(root.id!)
    assertCurrentRoot(current, root)
    const units = await db.adaptationSourceUnits
      .where('[adaptationProjectId+manifestVersion]')
      .equals([root.id!, input.sourceManifestVersion])
      .toArray()
    const unitKeys = new Set(units.map(unit => unit.sourceUnitKey))
    const rows = input.items.map(({ candidate, authorStatus }) => {
      assertKnownSourceUnits(candidate.sourceUnitKeys, unitKeys, `来源事实 ${candidate.stableKey}`)
      const row: AdaptationSourceFactV1 = stampNewRecord(scope, 'adaptationSourceFacts', {
        projectId: scope.projectId,
        workId: scope.workId,
        adaptationProjectId: root.id!,
        manifestVersion: input.sourceManifestVersion,
        stableKey: candidate.stableKey,
        kind: candidate.kind,
        statement: candidate.statement.trim(),
        subjectKeys: [...candidate.subjectKeys],
        sourceUnitKeys: [...candidate.sourceUnitKeys],
        confidence: candidate.confidence,
        authorStatus,
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' })
      assertAdaptationSourceFactV1(row)
      return row
    })
    const key = [root.id!, input.sourceManifestVersion] as [number, number]
    await Promise.all([
      db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
      db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
      db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).delete(),
    ])
    await db.adaptationSourceFacts.bulkAdd(rows)
    await db.adaptationProjects.update(root.id!, { revision: root.revision + 1, updatedAt: now })
    return db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey')
  })
}

export async function adoptAdaptationCausalEdgesV1(
  input: AnalysisAdoptionInput<AdaptationCausalEdgeCandidateV1>,
): Promise<AdaptationCausalEdgeV1[]> {
  assertReviewedBatch(input.items)
  input.items.forEach(({ candidate }) => assertCandidateShape(candidate, ['stableKey', 'fromFactKey', 'toFactKey', 'relation', 'rationale', 'sourceUnitKeys'], '因果边'))
  const { scope, root } = await requireWritableAnalysis(input)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.adaptationSourceFacts, db.adaptationCausalEdges), async () => {
    const current = await db.adaptationProjects.get(root.id!)
    assertCurrentRoot(current, root)
    const key = [root.id!, input.sourceManifestVersion] as [number, number]
    const [units, facts] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    ])
    const unitKeys = new Set(units.map(unit => unit.sourceUnitKey))
    const confirmedFactKeys = new Set(facts.filter(fact => fact.authorStatus === 'confirmed').map(fact => fact.stableKey))
    const rows = input.items.map(({ candidate, authorStatus }) => {
      if (!confirmedFactKeys.has(candidate.fromFactKey) || !confirmedFactKeys.has(candidate.toFactKey)) throw new Error(`[adaptation-analysis] 因果边 ${candidate.stableKey} 引用了未确认事实`)
      assertKnownSourceUnits(candidate.sourceUnitKeys, unitKeys, `因果边 ${candidate.stableKey}`)
      const row: AdaptationCausalEdgeV1 = stampNewRecord(scope, 'adaptationCausalEdges', {
        projectId: scope.projectId,
        workId: scope.workId,
        adaptationProjectId: root.id!,
        manifestVersion: input.sourceManifestVersion,
        stableKey: candidate.stableKey,
        fromFactKey: candidate.fromFactKey,
        toFactKey: candidate.toFactKey,
        relation: candidate.relation,
        rationale: candidate.rationale.trim(),
        sourceUnitKeys: [...candidate.sourceUnitKeys],
        authorStatus,
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' })
      assertAdaptationCausalEdgeV1(row)
      return row
    })
    await db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).delete()
    await db.adaptationCausalEdges.bulkAdd(rows)
    await db.adaptationProjects.update(root.id!, { revision: root.revision + 1, updatedAt: now })
    return db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey')
  })
}

export async function adoptAdaptationDecisionsV1(
  input: AnalysisAdoptionInput<AdaptationDecisionCandidateV1>,
): Promise<AdaptationDecisionV1[]> {
  assertReviewedBatch(input.items)
  input.items.forEach(({ candidate }) => assertCandidateShape(candidate, ['stableKey', 'action', 'sourceFactKeys', 'targetKeys', 'rationale'], '改编决策'))
  const { scope, root } = await requireWritableAnalysis(input)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceFacts, db.adaptationDecisions), async () => {
    const current = await db.adaptationProjects.get(root.id!)
    assertCurrentRoot(current, root)
    const key = [root.id!, input.sourceManifestVersion] as [number, number]
    const facts = await db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
    const confirmedFactKeys = new Set(facts.filter(fact => fact.authorStatus === 'confirmed').map(fact => fact.stableKey))
    const rows = input.items.map(({ candidate, authorStatus }) => {
      const unknown = candidate.sourceFactKeys.filter(factKey => !confirmedFactKeys.has(factKey))
      if (unknown.length) throw new Error(`[adaptation-analysis] 决策 ${candidate.stableKey} 引用了未确认事实：${unknown.join('、')}`)
      const row: AdaptationDecisionV1 = stampNewRecord(scope, 'adaptationDecisions', {
        projectId: scope.projectId,
        workId: scope.workId,
        adaptationProjectId: root.id!,
        manifestVersion: input.sourceManifestVersion,
        stableKey: candidate.stableKey,
        action: candidate.action,
        sourceFactKeys: [...candidate.sourceFactKeys],
        targetKeys: [...candidate.targetKeys],
        rationale: candidate.rationale.trim(),
        authorStatus,
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' })
      assertAdaptationDecisionV1(row)
      return row
    })
    await db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).delete()
    await db.adaptationDecisions.bulkAdd(rows)
    await db.adaptationProjects.update(root.id!, { revision: root.revision + 1, updatedAt: now })
    return db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey')
  })
}

export async function listAdaptationAnalysisV1(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  manifestVersion?: number
}): Promise<{
  facts: AdaptationSourceFactV1[]
  edges: AdaptationCausalEdgeV1[]
  decisions: AdaptationDecisionV1[]
}> {
  const scope = await resolveScope({ scope: input.scope })
  const root = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!root || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) throw new Error('[adaptation-analysis] 改编项目不属于当前目标 Work')
  const manifestVersion = input.manifestVersion ?? root.activeSourceManifestVersion
  if (!Number.isInteger(manifestVersion) || manifestVersion <= 0 || manifestVersion > root.activeSourceManifestVersion) throw new Error('[adaptation-analysis] 来源版本非法')
  const key = [root.id!, manifestVersion] as [number, number]
  const [facts, edges, decisions] = await Promise.all([
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
  ])
  return { facts, edges, decisions }
}
