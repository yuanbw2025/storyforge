import type { ScreenplayReleaseManifestV1 } from '../types'
import { assertAdaptationBriefV1, assertScreenplayTargetSpecV1 } from '../adaptation/contracts'
import { validateScreenplayBlocksV1 } from './contracts'
import { assertScreenplayBeatCandidateV1, assertScreenplaySceneCardCandidateV1 } from './production-contracts'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[screenplay-release] ${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[screenplay-release] ${label} 字段不在闭集`)
}

function array(value: unknown, label: string): asserts value is any[] {
  if (!Array.isArray(value)) throw new Error(`[screenplay-release] ${label} 必须是数组`)
}

function uniqueKeys(rows: any[], label: string): Set<string> {
  const keys = rows.map(row => row?.stableKey)
  if (keys.some(key => typeof key !== 'string' || !STABLE_KEY.test(key)) || new Set(keys).size !== keys.length) throw new Error(`[screenplay-release] ${label} stableKey 非法或重复`)
  return new Set(keys)
}

function rejectLocalIds(value: unknown, path = 'manifest'): void {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectLocalIds(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(projectId|worldId|workId|adaptationProjectId|sourceUnitIds|characterId)$/.test(key)) throw new Error(`[screenplay-release] 不得包含本地 ID：${path}.${key}`)
    rejectLocalIds(child, `${path}.${key}`)
  }
}

/** Pure codec used both when reading a release and before importing an external backup. */
export function assertScreenplayReleaseManifestV1(value: unknown, expectedWorkCode: string, expectedSourceRevision: number): asserts value is ScreenplayReleaseManifestV1 {
  exact(value, ['schema', 'version', 'productKind', 'work', 'adaptation', 'sourceUnits', 'facts', 'causalEdges', 'decisions', 'beats', 'sceneCards', 'scenes', 'reviewIssues', 'verification', 'createdAt'], 'manifest')
  if (value.schema !== 'storyforge.screenplay-release' || value.version !== 1 || value.productKind !== 'screenplay') throw new Error('[screenplay-release] manifest 身份非法')
  exact(value.work, ['code', 'title', 'description', 'genres'], 'work')
  if (value.work.code !== expectedWorkCode || typeof value.work.title !== 'string' || typeof value.work.description !== 'string' || !Array.isArray(value.work.genres)) throw new Error('[screenplay-release] Work 身份非法')
  exact(value.adaptation, ['revision', 'targetSpec', 'brief', 'sourceManifestVersion', 'sourceManifestHash'], 'adaptation')
  if (value.adaptation.revision !== expectedSourceRevision || !Number.isInteger(value.adaptation.sourceManifestVersion) || value.adaptation.sourceManifestVersion < 1 || !/^[a-f0-9]{64}$/.test(value.adaptation.sourceManifestHash)) throw new Error('[screenplay-release] 改编版本非法')
  assertScreenplayTargetSpecV1(value.adaptation.targetSpec)
  assertAdaptationBriefV1(value.adaptation.brief)
  for (const key of ['sourceUnits', 'facts', 'causalEdges', 'decisions', 'beats', 'sceneCards', 'scenes', 'reviewIssues'] as const) array(value[key], key)
  const sourceKeys = new Set<string>()
  for (const unit of value.sourceUnits) {
    exact(unit, ['sourceUnitKey', 'label', 'order', 'contentHash', 'wordCount'], 'sourceUnit')
    if (!/^asu_[A-Za-z0-9_-]{8,64}$/.test(unit.sourceUnitKey) || sourceKeys.has(unit.sourceUnitKey) || !/^[a-f0-9]{64}$/.test(unit.contentHash)) throw new Error('[screenplay-release] 来源单元非法或重复')
    sourceKeys.add(unit.sourceUnitKey)
  }
  const factKeys = uniqueKeys(value.facts, 'facts')
  const decisionKeys = uniqueKeys(value.decisions, 'decisions')
  const beatKeys = uniqueKeys(value.beats, 'beats')
  const cardKeys = uniqueKeys(value.sceneCards, 'sceneCards')
  uniqueKeys(value.causalEdges, 'causalEdges'); uniqueKeys(value.reviewIssues, 'reviewIssues')
  for (const beat of value.beats) {
    assertScreenplayBeatCandidateV1({ stableKey: beat.stableKey, sectionKey: beat.sectionKey, sectionTitle: beat.sectionTitle, scope: beat.scope, episodeNumber: beat.episodeNumber, order: beat.order, objective: beat.objective, conflict: beat.conflict, turn: beat.turn, outcome: beat.outcome, causalFactKeys: beat.causalFactKeys, decisionKeys: beat.decisionKeys, sourceUnitKeys: beat.sourceUnitKeys, estimatedSeconds: beat.estimatedSeconds })
    if (beat.causalFactKeys.some((key: string) => !factKeys.has(key)) || beat.decisionKeys.some((key: string) => !decisionKeys.has(key)) || beat.sourceUnitKeys.some((key: string) => !sourceKeys.has(key))) throw new Error('[screenplay-release] Beat 引用越界')
  }
  for (const card of value.sceneCards) {
    assertScreenplaySceneCardCandidateV1({ stableKey: card.stableKey, beatKey: card.beatKey, episodeNumber: card.episodeNumber, sceneNumber: card.sceneNumber, order: card.order, purpose: card.purpose, conflict: card.conflict, entryState: card.entryState, exitState: card.exitState, visibleAction: card.visibleAction, informationReveal: card.informationReveal, sourceUnitKeys: card.sourceUnitKeys, estimatedSeconds: card.estimatedSeconds })
    if (!beatKeys.has(card.beatKey) || card.sourceUnitKeys.some((key: string) => !sourceKeys.has(key))) throw new Error('[screenplay-release] Scene Card 引用越界')
  }
  const sceneKeys = uniqueKeys(value.scenes, 'scenes')
  if (sceneKeys.size !== cardKeys.size || [...cardKeys].some(key => !sceneKeys.has(key))) throw new Error('[screenplay-release] Scene Card 与场景不是一一对应')
  for (const scene of value.scenes) {
    if (!['reviewed', 'locked'].includes(scene.status) || !Number.isInteger(scene.revision) || scene.revision < 1
      || scene.groundingReviewRevision !== scene.revision || scene.dramaturgyReviewRevision !== scene.revision
      || !Array.isArray(scene.sourceUnitKeys) || scene.sourceUnitKeys.some((key: string) => !sourceKeys.has(key))
      || !validateScreenplayBlocksV1(scene.blocks).valid) throw new Error(`[screenplay-release] 场景 ${scene.stableKey} 未完成审查或结构非法`)
  }
  for (const issue of value.reviewIssues) {
    if (!sceneKeys.has(issue.sceneKey) || (issue.blockId != null && !value.scenes.find((scene: any) => scene.stableKey === issue.sceneKey)?.blocks.some((block: any) => block.id === issue.blockId))
      || !Array.isArray(issue.sourceUnitKeys) || issue.sourceUnitKeys.some((key: string) => !sourceKeys.has(key))) throw new Error('[screenplay-release] ReviewIssue 引用越界')
  }
  exact(value.verification, ['blockers', 'warnings', 'totalEstimatedSeconds', 'targetEstimatedSeconds', 'reviewedAt'], 'verification')
  if (!Array.isArray(value.verification.blockers) || value.verification.blockers.length || !Array.isArray(value.verification.warnings)
    || !Number.isFinite(value.verification.totalEstimatedSeconds) || !Number.isFinite(value.verification.targetEstimatedSeconds)
    || !Number.isInteger(value.verification.reviewedAt) || value.verification.reviewedAt < 1 || value.createdAt !== value.verification.reviewedAt) throw new Error('[screenplay-release] verification 非法')
  rejectLocalIds(value)
}
