import Dexie from 'dexie'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunV1 } from '../agent/run/event-store'
import { verifyContextGatewayCandidateEvidenceV1 } from '../context-gateway/attempt-evidence'
import { db } from '../db/schema'
import {
  putMediaBlobObject,
  readMediaBlobObjectData,
} from '../game-production/media-blob-store'
import {
  createGameReleaseManifestV2,
  parseGameRuntimePackageV2,
} from '../game-production/runtime-package'
import { hashGameProductionValueV2 } from '../game-production/hash'
import { detectGameImageDimensionsV1, detectGameMediaMimeTypeV1 } from '../game-production/media-adapters'
import { readSimulationState } from '../simulation/runtime'
import type {
  CharacterInteractionArtifactKindV1,
  CharacterInteractionArtifactRecordV1,
  CharacterInteractionBriefV1,
  CharacterInteractionMediaAssetRecordV1,
  CharacterInteractionMediaKindV1,
  CharacterInteractionProductReleaseManifestV1,
  CharacterInteractionProductReleaseRecordV1,
  CharacterInteractionProductionStepKeyV1,
  CharacterInteractionProductionStepRecordV1,
  CharacterInteractionWorldSourceCatalogV1,
  CharacterInteractionWorldSourceSelectionV1,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  GameRelease,
  GameRuntimePackageV2,
  InteractionKnowledgeSeed,
  InteractionRelationshipDimension,
  LocalContextManifestAttemptV1,
  ProductReleaseLineageV1,
  ProductSourceManifestV1,
  ProductSourcePlanV1,
  ConfirmedProductBriefV1,
  SimulationEvent,
  WorkspaceScope,
  WorldGameSourceSelectionV2,
} from '../types'
import { CHARACTER_INTERACTION_PRODUCTION_STEPS_V1 } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import {
  aggregateProductSourceManifestFromExactRunsV1,
  createProductReleaseLineageV1,
  productReleaseUidV1,
  validateConfirmedProductBriefV1,
  validateProductReleaseLineageV1,
  validateProductSourceManifestV1,
} from '../world-engine/product-source-contracts'
import {
  assertCharacterInteractionFormalProductionReadyV1,
  createCharacterInteractionProductionV1,
  hashCharacterInteractionProductionValueV1,
  loadCharacterInteractionProductionV1,
  type CharacterInteractionBriefInputV1,
  type CharacterInteractionProductionBundleV1,
} from './production'
import {
  loadCharacterInteractionWorldSourceCatalogV1,
  readCharacterInteractionSelectedWorldRowsV1,
} from './world-source'

const HASH = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const STEP_INDEX = new Map(CHARACTER_INTERACTION_PRODUCTION_STEPS_V1.map((step, index) => [step, index]))

function fail(message: string): never { throw new Error(`[chatgame-pipeline] ${message}`) }
function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}
function stableKey(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!STABLE_KEY.test(result)) fail(`${label} 不是稳定 key`)
  return result
}
function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return fail(`${label} JSON 已损坏`) }
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}
function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function nowError(error: unknown): string {
  return canonicalStringify({
    code: 'character-interaction-production-failed',
    message: error instanceof Error ? error.message : String(error),
    recordedAt: Date.now(),
  })
}

export interface CharacterInteractionCapsulesArtifactV1 {
  schema: 'storyforge.character-interaction-character-capsules'
  version: 1
  capsules: Array<{
    participantKey: string
    characterKey: string
    name: string
    source: 'world' | 'guest'
    roleLabel: string
    identitySummary: string
    voiceRules: string
    publicStance: string
    privateAnchor: string
    maxMemoryEntries: number
  }>
}

export interface CharacterInteractionSeedsArtifactV1 {
  schema: 'storyforge.character-interaction-seeds'
  version: 1
  knowledge: Array<{
    participantKey: string
    entries: InteractionKnowledgeSeed[]
    prohibitedDisclosure: string[]
  }>
  relationships: Array<{
    fromParticipantKey: string
    toParticipantKey: 'player' | string
    dimensions: InteractionRelationshipDimension[]
  }>
}

export interface CharacterInteractionScenePlanArtifactV1 {
  schema: 'storyforge.character-interaction-scene-plan'
  version: 1
  scenes: Array<{
    sceneKey: string
    title: string
    purpose: string
    location: string
    timeLabel: string
    participantKeys: string[]
    goals: string[]
    endingConditions: string[]
    safetyBoundaries: string[]
    maxTurns: number
    directorBudget: number
  }>
}

export interface CharacterInteractionNarrativeLinksArtifactV1 {
  schema: 'storyforge.character-interaction-narrative-links'
  version: 1
  entrySceneKey: string
  links: Array<{ linkKey: string; fromSceneKey: string; toSceneKey: string; condition: string }>
  endingSceneKeys: string[]
}

export interface CharacterInteractionMediaBibleArtifactV1 {
  schema: 'storyforge.character-interaction-media-bible'
  version: 1
  tier: CharacterInteractionBriefV1['media']['tier']
  style: { description: string; prohibitedElements: string[]; rightsPolicyVersion: 'character-interaction-rights-v1' }
  slots: Array<{
    slotKey: string
    assetKey: string
    kind: CharacterInteractionMediaKindV1
    targetRef: string
    required: boolean
    prompt: string
    fallbackText: string
    altText: string
  }>
}

export interface CharacterInteractionIntegrationArtifactV1 {
  schema: 'storyforge.character-interaction-integration'
  version: 1
  profiles: FrozenInteractionCharacterProfile[]
  sceneTemplates: FrozenInteractionSceneTemplate[]
}

export interface CharacterInteractionValidationArtifactV1 {
  schema: 'storyforge.character-interaction-validation'
  version: 1
  valid: boolean
  checks: Array<{ check: string; status: 'passed' | 'failed'; detail: string }>
}

export interface CharacterInteractionPreviewArtifactV1 {
  schema: 'storyforge.character-interaction-author-preview'
  version: 1
  title: string
  participantNames: string[]
  sceneTitles: string[]
  mediaTier: CharacterInteractionBriefV1['media']['tier']
  warnings: string[]
}

export type CharacterInteractionProductionArtifactPayloadV1 =
  | CharacterInteractionCapsulesArtifactV1
  | CharacterInteractionSeedsArtifactV1
  | CharacterInteractionScenePlanArtifactV1
  | CharacterInteractionNarrativeLinksArtifactV1
  | CharacterInteractionMediaBibleArtifactV1
  | CharacterInteractionIntegrationArtifactV1
  | CharacterInteractionValidationArtifactV1
  | CharacterInteractionPreviewArtifactV1

export interface CharacterInteractionProductionDetailsV1 extends CharacterInteractionProductionBundleV1 {
  steps: CharacterInteractionProductionStepRecordV1[]
  artifacts: CharacterInteractionArtifactRecordV1[]
  mediaAssets: CharacterInteractionMediaAssetRecordV1[]
  releases: CharacterInteractionProductReleaseRecordV1[]
}

export async function hashCharacterInteractionProductReleaseManifestV1(
  manifest: CharacterInteractionProductReleaseManifestV1,
): Promise<string> {
  const portable = structuredClone(manifest) as CharacterInteractionProductReleaseManifestV1
  portable.source.worldReleaseId = 0
  portable.source.selection.worldReleaseId = 0
  portable.brief.content.source.worldReleaseId = 0
  return hashCharacterInteractionProductionValueV1(portable)
}

async function hashCharacterInteractionArtifactPayloadV1(
  kind: CharacterInteractionArtifactKindV1,
  value: unknown,
): Promise<string> {
  if (kind !== 'world-upgrade-plan') return hashCanonicalValue(value)
  const portable = structuredClone(record(value, 'worldUpgradePayload'))
  const from = record(portable.from, 'worldUpgradePayload.from')
  const to = record(portable.to, 'worldUpgradePayload.to')
  from.worldReleaseId = 0
  to.worldReleaseId = 0
  return hashCanonicalValue(portable)
}

function artifactKind(step: CharacterInteractionProductionStepKeyV1): CharacterInteractionArtifactKindV1 {
  if (step === 'counterexample-validation') return 'validation-report'
  if (step === 'author-preview') return 'author-preview'
  return step
}

function participantCharacterRecord(
  catalog: CharacterInteractionWorldSourceCatalogV1,
  selection: CharacterInteractionWorldSourceSelectionV1,
  participantKey: string,
) {
  const match = /^world-character:(\d+)$/.exec(participantKey)
  if (!match) return null
  const exportId = Number(match[1])
  if (!selection.participantCharacterExportIds.includes(exportId)) fail(`参与角色超出 Selection:${participantKey}`)
  return (catalog.records.characters ?? []).find(item => item.exportId === exportId) ?? fail(`冻结角色不存在:${participantKey}`)
}

function capsules(bundle: CharacterInteractionProductionBundleV1): CharacterInteractionCapsulesArtifactV1 {
  const guestByKey = new Map(bundle.brief.guests.map(item => [item.guestKey, item]))
  return {
    schema: 'storyforge.character-interaction-character-capsules', version: 1,
    capsules: bundle.brief.participants.map(participant => {
      const world = participant.source === 'world'
        ? participantCharacterRecord(bundle.catalog, bundle.selection, participant.participantKey) : null
      const guest = participant.source === 'guest' ? guestByKey.get(participant.participantKey) : null
      const identitySummary = world?.summary || guest?.profile || participant.reason
      const characterKey = participant.source === 'world'
        ? `release-character:${world!.exportId}` : guest?.guestKey ?? fail('原创角色快照缺失')
      return {
        participantKey: stableKey(participant.participantKey, 'participantKey'),
        characterKey: stableKey(characterKey, 'characterKey'), name: participant.displayName,
        source: participant.source, roleLabel: participant.reason,
        identitySummary,
        voiceRules: `保持“${participant.displayName}”的身份、经历与价值判断；只依据可见知识发言。${identitySummary}`.slice(0, 8_000),
        publicStance: bundle.brief.knowledgePolicy.publicKnowledge.join('；') || '不主动宣称未冻结的世界事实。',
        privateAnchor: bundle.brief.knowledgePolicy.privateKnowledge.join('；') || '没有额外私密锚点。',
        maxMemoryEntries: 48,
      }
    }),
  }
}

function seeds(bundle: CharacterInteractionProductionBundleV1, capsulePayload: CharacterInteractionCapsulesArtifactV1): CharacterInteractionSeedsArtifactV1 {
  const dimensions = bundle.brief.relationshipPolicy.dimensions.map(key => ({
    key,
    label: ({ trust: '信任', closeness: '亲近', wariness: '戒备', respect: '尊重' } as const)[key],
    minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3,
  }))
  return {
    schema: 'storyforge.character-interaction-seeds', version: 1,
    knowledge: capsulePayload.capsules.map(capsule => ({
      participantKey: capsule.participantKey,
      entries: [
        ...bundle.brief.knowledgePolicy.publicKnowledge.map((content, index) => ({
          key: `brief.public.${index + 1}`, content, visibility: 'public' as const, importance: 60,
        })),
        ...bundle.brief.knowledgePolicy.privateKnowledge.map((content, index) => ({
          key: `brief.private.${index + 1}`, content, visibility: 'private' as const, importance: 80,
        })),
        { key: `profile.${capsule.participantKey}`, content: capsule.identitySummary, visibility: 'public' as const, importance: 100 },
      ],
      prohibitedDisclosure: [...bundle.brief.knowledgePolicy.prohibitedDisclosure],
    })),
    relationships: capsulePayload.capsules.flatMap(capsule => [
      { fromParticipantKey: capsule.participantKey, toParticipantKey: 'player' as const, dimensions: structuredClone(dimensions) },
      ...capsulePayload.capsules.filter(other => other.participantKey !== capsule.participantKey).map(other => ({
        fromParticipantKey: capsule.participantKey, toParticipantKey: other.participantKey, dimensions: structuredClone(dimensions),
      })),
    ]),
  }
}

function scenePlan(bundle: CharacterInteractionProductionBundleV1): CharacterInteractionScenePlanArtifactV1 {
  const count = bundle.brief.runtime.sceneCount
  const participants = bundle.brief.participants.map(item => item.participantKey)
  const baseTitle = bundle.brief.setting.chatGoal || bundle.brief.title
  return {
    schema: 'storyforge.character-interaction-scene-plan', version: 1,
    scenes: Array.from({ length: count }, (_, index) => ({
      sceneKey: `scene-${index + 1}`,
      title: count === 1 ? bundle.brief.title : `${baseTitle} · ${index + 1}`,
      purpose: index === 0 ? bundle.brief.setting.chatGoal : bundle.brief.setting.desiredDirections[index - 1] ?? `继续推进：${bundle.brief.setting.chatGoal}`,
      location: bundle.brief.setting.locationContext,
      timeLabel: bundle.brief.setting.timeContext,
      participantKeys: [...participants],
      goals: unique([bundle.brief.setting.chatGoal, ...bundle.brief.setting.desiredDirections]).filter(Boolean),
      endingConditions: bundle.brief.runtime.endingStrategy === 'open-ended'
        ? ['玩家主动结束场景', `达到 ${bundle.brief.runtime.maxTurnsPerScene} 回合`]
        : ['聊天目标完成', '玩家主动结束场景', `达到 ${bundle.brief.runtime.maxTurnsPerScene} 回合`],
      safetyBoundaries: unique(['不替玩家决定感受或行动', ...bundle.brief.setting.safetyBoundaries]),
      maxTurns: bundle.brief.runtime.maxTurnsPerScene,
      directorBudget: bundle.brief.runtime.directorBudget,
    })),
  }
}

function narrativeLinks(plan: CharacterInteractionScenePlanArtifactV1): CharacterInteractionNarrativeLinksArtifactV1 {
  return {
    schema: 'storyforge.character-interaction-narrative-links', version: 1,
    entrySceneKey: plan.scenes[0]?.sceneKey ?? fail('场景计划为空'),
    links: plan.scenes.slice(0, -1).map((scene, index) => ({
      linkKey: `${scene.sceneKey}.to.${plan.scenes[index + 1].sceneKey}`,
      fromSceneKey: scene.sceneKey, toSceneKey: plan.scenes[index + 1].sceneKey,
      condition: '作者或玩家明确进入下一场景',
    })),
    endingSceneKeys: [plan.scenes[plan.scenes.length - 1].sceneKey],
  }
}

function mediaBible(bundle: CharacterInteractionProductionBundleV1, capsulePayload: CharacterInteractionCapsulesArtifactV1): CharacterInteractionMediaBibleArtifactV1 {
  const tier = bundle.brief.media.tier
  const portraitSlots = tier === 'text-core' ? [] : capsulePayload.capsules.map(capsule => ({
    slotKey: `portrait:${capsule.participantKey}`, assetKey: `portrait.${capsule.participantKey}`,
    kind: 'portrait' as const, targetRef: capsule.participantKey, required: true,
    prompt: `角色立绘：${capsule.name}。${capsule.identitySummary}`,
    fallbackText: `${capsule.name}（文字头像）`, altText: `${capsule.name} 的角色立绘`,
  }))
  const voiceSlots = tier !== 'voice-optional' ? [] : capsulePayload.capsules.map(capsule => ({
    slotKey: `voice:${capsule.participantKey}`, assetKey: `voice.${capsule.participantKey}`,
    kind: 'voice-sample' as const, targetRef: capsule.participantKey, required: false,
    prompt: `角色语音样本：${capsule.name}。${capsule.voiceRules}`,
    fallbackText: '无语音时使用文字与系统朗读设置。', altText: `${capsule.name} 的语音样本`,
  }))
  return {
    schema: 'storyforge.character-interaction-media-bible', version: 1, tier,
    style: {
      description: `围绕“${bundle.brief.title}”保持角色身份一致、避免文字水印与未授权形象。`,
      prohibitedElements: ['文字水印', '替换角色身份锚点', '未授权商标'],
      rightsPolicyVersion: 'character-interaction-rights-v1',
    },
    slots: [...portraitSlots, ...voiceSlots],
  }
}

function integration(
  capsulesPayload: CharacterInteractionCapsulesArtifactV1,
  seedsPayload: CharacterInteractionSeedsArtifactV1,
  plan: CharacterInteractionScenePlanArtifactV1,
): CharacterInteractionIntegrationArtifactV1 {
  const knowledge = new Map(seedsPayload.knowledge.map(item => [item.participantKey, item.entries]))
  const relationships = new Map(seedsPayload.relationships
    .filter(item => item.toParticipantKey === 'player')
    .map(item => [item.fromParticipantKey, item.dimensions]))
  const profiles: FrozenInteractionCharacterProfile[] = capsulesPayload.capsules.map(capsule => ({
    participantKey: capsule.participantKey, characterKey: capsule.characterKey, name: capsule.name,
    roleLabel: capsule.roleLabel, voiceRules: capsule.voiceRules,
    initialKnowledge: structuredClone(knowledge.get(capsule.participantKey) ?? []),
    relationshipDimensions: structuredClone(relationships.get(capsule.participantKey) ?? []),
    maxMemoryEntries: capsule.maxMemoryEntries,
  }))
  const sceneTemplates: FrozenInteractionSceneTemplate[] = plan.scenes.map((scene, index) => ({
    ...scene,
    publicKnowledgeKeys: unique(profiles.flatMap(profile => profile.initialKnowledge.filter(item => item.visibility === 'public').map(item => item.key))),
    relationshipRules: [], openingNodeKey: `narrative.${scene.sceneKey}`,
    endingNodeKey: index === plan.scenes.length - 1 ? 'narrative.ending' : `narrative.${plan.scenes[index + 1].sceneKey}`,
    order: index,
  }))
  return { schema: 'storyforge.character-interaction-integration', version: 1, profiles, sceneTemplates }
}

function validateIntegration(
  bundle: CharacterInteractionProductionBundleV1,
  integrated: CharacterInteractionIntegrationArtifactV1,
  media: CharacterInteractionMediaBibleArtifactV1,
): CharacterInteractionValidationArtifactV1 {
  const participantKeys = integrated.profiles.map(item => item.participantKey)
  const checks: CharacterInteractionValidationArtifactV1['checks'] = []
  const check = (name: string, passed: boolean, detail: string) => checks.push({ check: name, status: passed ? 'passed' : 'failed', detail })
  check('frozen-source', HASH.test(bundle.selection.selectionHash) && HASH.test(bundle.selection.worldContentHash), '只绑定冻结 WorldRelease / Selection hash')
  check('participants', participantKeys.length > 0 && participantKeys.length <= 8 && new Set(participantKeys).size === participantKeys.length, `${participantKeys.length} 个唯一参与者`)
  check('scenes', integrated.sceneTemplates.length > 0 && integrated.sceneTemplates.every(scene => scene.participantKeys.every(key => participantKeys.includes(key))), `${integrated.sceneTemplates.length} 个场景均只引用已冻结参与者`)
  check('knowledge-isolation', integrated.profiles.every(profile => profile.initialKnowledge.every(entry => ['public', 'private'].includes(entry.visibility))), '知识具有显式公开/私密可见性')
  check('relationship-evidence', integrated.profiles.every(profile => profile.relationshipDimensions.every(dimension => dimension.largeChangeThreshold >= 0)), '重大关系变化阈值已冻结')
  check('media-plan', media.tier === 'text-core' ? media.slots.length === 0 : media.slots.some(slot => slot.kind === 'portrait'), `${media.tier} 媒资计划可显式降级`)
  check('no-live-dexie-identity', !canonicalStringify(integrated).includes('characterId'), '运行包不含活动角色 Dexie ID')
  return { schema: 'storyforge.character-interaction-validation', version: 1, valid: checks.every(item => item.status === 'passed'), checks }
}

function preview(
  bundle: CharacterInteractionProductionBundleV1,
  integrated: CharacterInteractionIntegrationArtifactV1,
  media: CharacterInteractionMediaBibleArtifactV1,
): CharacterInteractionPreviewArtifactV1 {
  return {
    schema: 'storyforge.character-interaction-author-preview', version: 1,
    title: bundle.brief.title,
    participantNames: integrated.profiles.map(item => item.name),
    sceneTitles: integrated.sceneTemplates.map(item => item.title),
    mediaTier: media.tier,
    warnings: [
      ...(bundle.brief.worldFeedback.allowCandidate ? ['运行事实只能形成世界回写候选，不能自动改写世界。'] : []),
      ...(media.slots.length ? ['发布前必须为必需媒资绑定完整字节，或由作者显式确认文字降级。'] : []),
    ],
  }
}

async function scopedArtifact(scope: WorkspaceScope, id: number): Promise<CharacterInteractionArtifactRecordV1> {
  const row = await db.characterInteractionArtifacts.get(id)
  if (!row || !await assertRecordInScope(scope, 'characterInteractionArtifacts', row, { owner: 'work' })) fail('产物不存在或跨 Work')
  if (await hashCharacterInteractionArtifactPayloadV1(row.kind, parseJson(row.payloadJson, 'artifact.payload')) !== row.payloadHash) fail('产物 payload hash 不一致')
  return row
}

async function confirmedArtifacts(productionId: number): Promise<Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>> {
  const rows = await db.characterInteractionArtifacts.where('productionId').equals(productionId).toArray()
  const result = new Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>()
  for (const row of rows.filter(item => item.stepKey != null && item.status === 'confirmed').sort((a, b) => a.revision - b.revision)) {
    result.set(row.stepKey!, row)
  }
  return result
}

function payload<T>(rows: Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>, step: CharacterInteractionProductionStepKeyV1): T {
  const row = rows.get(step) ?? fail(`缺少已确认前置产物:${step}`)
  return parseJson(row.payloadJson, `${step}.payload`) as T
}

async function buildStepPayload(
  bundle: CharacterInteractionProductionBundleV1,
  step: CharacterInteractionProductionStepKeyV1,
  dependencies: Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>,
): Promise<CharacterInteractionProductionArtifactPayloadV1> {
  if (step === 'character-capsules') return capsules(bundle)
  const capsulePayload = payload<CharacterInteractionCapsulesArtifactV1>(dependencies, 'character-capsules')
  if (step === 'knowledge-and-relationship-seeds') return seeds(bundle, capsulePayload)
  if (step === 'scene-plan') return scenePlan(bundle)
  const plan = payload<CharacterInteractionScenePlanArtifactV1>(dependencies, 'scene-plan')
  if (step === 'narrative-links') return narrativeLinks(plan)
  if (step === 'media-bible') return mediaBible(bundle, capsulePayload)
  const seedsPayload = payload<CharacterInteractionSeedsArtifactV1>(dependencies, 'knowledge-and-relationship-seeds')
  if (step === 'integration') return integration(capsulePayload, seedsPayload, plan)
  const integrated = payload<CharacterInteractionIntegrationArtifactV1>(dependencies, 'integration')
  const media = payload<CharacterInteractionMediaBibleArtifactV1>(dependencies, 'media-bible')
  if (step === 'counterexample-validation') return validateIntegration(bundle, integrated, media)
  const validation = payload<CharacterInteractionValidationArtifactV1>(dependencies, 'counterexample-validation')
  if (!validation.valid) fail('反例验证未通过，不能形成作者预览')
  return preview(bundle, integrated, media)
}

async function validateStepPayload(
  bundle: CharacterInteractionProductionBundleV1,
  step: CharacterInteractionProductionStepKeyV1,
  dependencies: Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>,
  candidate: CharacterInteractionProductionArtifactPayloadV1,
): Promise<void> {
  const expected = await buildStepPayload(bundle, step, dependencies)
  if (!['character-capsules', 'scene-plan', 'media-bible'].includes(step)) {
    if (await hashCanonicalValue(candidate) !== await hashCanonicalValue(expected)) {
      fail(`${step} 必须由确定性编译器生成，不能注入任意候选`)
    }
    return
  }
  if (step === 'character-capsules') {
    const actual = record(candidate, 'character-capsules')
    exactKeys(actual, ['schema', 'version', 'capsules'], 'character-capsules')
    if (actual.schema !== 'storyforge.character-interaction-character-capsules' || actual.version !== 1 || !Array.isArray(actual.capsules)) fail('角色胶囊协议无效')
    const baseline = expected as CharacterInteractionCapsulesArtifactV1
    if (actual.capsules.length !== baseline.capsules.length) fail('角色胶囊参与者数量变化')
    actual.capsules.forEach((value, index) => {
      const row = record(value, `capsules[${index}]`)
      exactKeys(row, ['participantKey', 'characterKey', 'name', 'source', 'roleLabel', 'identitySummary', 'voiceRules', 'publicStance', 'privateAnchor', 'maxMemoryEntries'], `capsules[${index}]`)
      const frozen = baseline.capsules[index]
      for (const key of ['participantKey', 'characterKey', 'name', 'source', 'roleLabel', 'maxMemoryEntries'] as const) {
        if (row[key] !== frozen[key]) fail(`角色胶囊不能修改冻结字段:${key}`)
      }
      for (const key of ['identitySummary', 'voiceRules', 'publicStance', 'privateAnchor'] as const) text(row[key], `capsules[${index}].${key}`, 8_000)
    })
    return
  }
  if (step === 'scene-plan') {
    const actual = record(candidate, 'scene-plan')
    exactKeys(actual, ['schema', 'version', 'scenes'], 'scene-plan')
    if (actual.schema !== 'storyforge.character-interaction-scene-plan' || actual.version !== 1 || !Array.isArray(actual.scenes)) fail('场景计划协议无效')
    const baseline = expected as CharacterInteractionScenePlanArtifactV1
    if (actual.scenes.length !== baseline.scenes.length) fail('场景计划数量变化')
    actual.scenes.forEach((value, index) => {
      const row = record(value, `scenes[${index}]`)
      exactKeys(row, ['sceneKey', 'title', 'purpose', 'location', 'timeLabel', 'participantKeys', 'goals', 'endingConditions', 'safetyBoundaries', 'maxTurns', 'directorBudget'], `scenes[${index}]`)
      const frozen = baseline.scenes[index]
      for (const key of ['sceneKey', 'location', 'timeLabel', 'maxTurns', 'directorBudget'] as const) {
        if (row[key] !== frozen[key]) fail(`场景计划不能修改冻结字段:${key}`)
      }
      for (const key of ['participantKeys', 'safetyBoundaries'] as const) {
        if (canonicalStringify(row[key]) !== canonicalStringify(frozen[key])) fail(`场景计划不能修改冻结字段:${key}`)
      }
      text(row.title, `scenes[${index}].title`, 500)
      text(row.purpose, `scenes[${index}].purpose`, 8_000)
      if (!Array.isArray(row.goals) || !row.goals.length || row.goals.some(item => typeof item !== 'string' || !item.trim())) fail('场景 goals 无效')
      if (!Array.isArray(row.endingConditions) || !row.endingConditions.length || row.endingConditions.some(item => typeof item !== 'string' || !item.trim())) fail('场景 endingConditions 无效')
    })
    return
  }
  const actual = record(candidate, 'media-bible')
  exactKeys(actual, ['schema', 'version', 'tier', 'style', 'slots'], 'media-bible')
  if (actual.schema !== 'storyforge.character-interaction-media-bible' || actual.version !== 1 || !Array.isArray(actual.slots)) fail('媒资 Bible 协议无效')
  const baseline = expected as CharacterInteractionMediaBibleArtifactV1
  if (actual.tier !== baseline.tier || actual.slots.length !== baseline.slots.length) fail('媒资 Bible 档位或槽位数量变化')
  const style = record(actual.style, 'media-bible.style')
  exactKeys(style, ['description', 'prohibitedElements', 'rightsPolicyVersion'], 'media-bible.style')
  text(style.description, 'media-bible.style.description')
  if (style.rightsPolicyVersion !== baseline.style.rightsPolicyVersion
    || canonicalStringify(style.prohibitedElements) !== canonicalStringify(baseline.style.prohibitedElements)) fail('媒资权利与禁止项不能由模型修改')
  actual.slots.forEach((value, index) => {
    const row = record(value, `slots[${index}]`)
    exactKeys(row, ['slotKey', 'assetKey', 'kind', 'targetRef', 'required', 'prompt', 'fallbackText', 'altText'], `slots[${index}]`)
    const frozen = baseline.slots[index]
    for (const key of ['slotKey', 'assetKey', 'kind', 'targetRef', 'required'] as const) {
      if (row[key] !== frozen[key]) fail(`媒资槽不能修改冻结字段:${key}`)
    }
    text(row.prompt, `slots[${index}].prompt`)
    text(row.fallbackText, `slots[${index}].fallbackText`, 1_000)
    text(row.altText, `slots[${index}].altText`, 500)
  })
}

function precedingSteps(step: CharacterInteractionProductionStepKeyV1): CharacterInteractionProductionStepKeyV1[] {
  const index = STEP_INDEX.get(step) ?? fail(`未知生产步骤:${step}`)
  return CHARACTER_INTERACTION_PRODUCTION_STEPS_V1.slice(0, index)
}

async function nextAttempt(productionId: number, step: CharacterInteractionProductionStepKeyV1): Promise<number> {
  const rows = await db.characterInteractionProductionSteps.where('[productionId+stepKey]').equals([productionId, step]).toArray()
  return Math.max(0, ...rows.map(row => row.attempt)) + 1
}

export async function readCharacterInteractionProductionDetailsV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<CharacterInteractionProductionDetailsV1> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await loadCharacterInteractionProductionV1({ scope, productionId: input.productionId })
  const [steps, artifacts, mediaAssets, releases] = await Promise.all([
    db.characterInteractionProductionSteps.where('productionId').equals(input.productionId).sortBy('updatedAt'),
    db.characterInteractionArtifacts.where('productionId').equals(input.productionId).sortBy('createdAt'),
    db.characterInteractionMediaAssets.where('productionId').equals(input.productionId).sortBy('updatedAt'),
    db.characterInteractionProductReleases.where('productionId').equals(input.productionId).sortBy('version'),
  ])
  return { ...bundle, steps, artifacts, mediaAssets, releases }
}

/** Read-only draft compiler used by the governed AI Harness before it creates a candidate. */
export async function prepareCharacterInteractionStepDraftV1(input: {
  scope: WorkspaceScope
  productionId: number
  stepKey: CharacterInteractionProductionStepKeyV1
}): Promise<CharacterInteractionProductionArtifactPayloadV1> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await assertCharacterInteractionFormalProductionReadyV1({ scope, productionId: input.productionId })
  if (['released', 'archived'].includes(bundle.production.status)) fail('已发布或归档生产不能生成草稿')
  const dependencies = await confirmedArtifacts(input.productionId)
  const missing = precedingSteps(input.stepKey).filter(step => !dependencies.has(step))
  if (missing.length) fail(`必须先确认前置步骤:${missing.join('、')}`)
  return buildStepPayload(bundle, input.stepKey, dependencies)
}

/** Deterministic local candidate; formal model candidates use the same adoption gate and carry producerRunId. */
export async function generateCharacterInteractionStepCandidateV1(input: {
  scope: WorkspaceScope
  productionId: number
  stepKey: CharacterInteractionProductionStepKeyV1
  producerRunId?: number | null
  candidatePayload?: CharacterInteractionProductionArtifactPayloadV1
}): Promise<CharacterInteractionArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await assertCharacterInteractionFormalProductionReadyV1({ scope, productionId: input.productionId })
  if (['released', 'archived'].includes(bundle.production.status)) fail('已发布或归档生产不能重生成')
  const dependencies = await confirmedArtifacts(input.productionId)
  const required = precedingSteps(input.stepKey)
  const missing = required.filter(step => !dependencies.has(step))
  if (missing.length) fail(`必须先确认前置步骤:${missing.join('、')}`)
  const dependencyHash = await hashCanonicalValue(required.map(step => ({ step, hash: dependencies.get(step)!.payloadHash })))
  const inputHash = await hashCanonicalValue({
    sourceSelectionHash: bundle.selection.selectionHash,
    briefHash: bundle.briefRecord.briefHash,
    stepKey: input.stepKey,
    dependencyHash,
  })
  const attempt = await nextAttempt(input.productionId, input.stepKey)
  const startedAt = Date.now()
  const stepId = await db.characterInteractionProductionSteps.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId: input.productionId, stepKey: input.stepKey, attempt,
    status: 'running', inputHash, candidateArtifactId: null, confirmedArtifactId: null,
    producerRunId: input.producerRunId ?? null, checkpointJson: '{}', errorJson: null,
    startedAt, completedAt: null, updatedAt: startedAt,
  }) as number
  try {
    const candidatePayload = input.candidatePayload ?? await buildStepPayload(bundle, input.stepKey, dependencies)
    await validateStepPayload(bundle, input.stepKey, dependencies, candidatePayload)
    const payloadHash = await hashCharacterInteractionArtifactPayloadV1(artifactKind(input.stepKey), candidatePayload)
    const createdAt = Date.now()
    return db.transaction('rw', scopeTransactionTables(
      db.characterInteractionProductions, db.characterInteractionProductionSteps,
      db.characterInteractionArtifacts, db.characterInteractionMediaAssets,
    ), async () => {
      const current = await db.characterInteractionProductions.get(input.productionId)
      const currentStep = await db.characterInteractionProductionSteps.get(stepId)
      if (!current || current.activeSourceSelectionId !== bundle.sourceRecord.id
        || current.activeBriefId !== bundle.briefRecord.id || currentStep?.status !== 'running') fail('候选提交前生产输入或步骤已变化')
      const index = STEP_INDEX.get(input.stepKey)!
      const laterSteps = await db.characterInteractionProductionSteps.where('productionId').equals(input.productionId)
        .and(row => (STEP_INDEX.get(row.stepKey) ?? -1) >= index && row.id !== stepId && !['stale', 'rejected'].includes(row.status)).toArray()
      for (const row of laterSteps) await db.characterInteractionProductionSteps.update(row.id!, { status: 'stale', updatedAt: createdAt })
      const laterArtifacts = await db.characterInteractionArtifacts.where('productionId').equals(input.productionId)
        .and(row => row.stepKey != null && (STEP_INDEX.get(row.stepKey) ?? -1) >= index && row.status !== 'superseded').toArray()
      for (const row of laterArtifacts) await db.characterInteractionArtifacts.update(row.id!, { status: row.status === 'candidate' ? 'rejected' : 'superseded' })
      if (index <= STEP_INDEX.get('media-bible')!) {
        await db.characterInteractionMediaAssets.where('productionId').equals(input.productionId)
          .and(row => row.status !== 'superseded').modify({ status: 'superseded', updatedAt: createdAt })
      }
      const revisions = await db.characterInteractionArtifacts.where('[productionId+artifactKey+revision]')
        .between([input.productionId, input.stepKey, Dexie.minKey], [input.productionId, input.stepKey, Dexie.maxKey]).toArray()
      const artifact: CharacterInteractionArtifactRecordV1 = {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productionId: input.productionId, stepKey: input.stepKey, artifactKey: input.stepKey,
        revision: Math.max(0, ...revisions.map(row => row.revision)) + 1,
        kind: artifactKind(input.stepKey), status: 'candidate',
        sourceSelectionHash: bundle.selection.selectionHash, briefHash: bundle.briefRecord.briefHash,
        dependencyHash, payloadJson: canonicalStringify(candidatePayload), payloadHash,
        producerRunId: input.producerRunId ?? null, sourceSessionId: null,
        confirmationJson: null, createdAt, confirmedAt: null,
      }
      const artifactId = await db.characterInteractionArtifacts.add(artifact) as number
      await db.characterInteractionProductionSteps.update(stepId, {
        status: 'awaiting-confirmation', candidateArtifactId: artifactId,
        checkpointJson: canonicalStringify({
          artifactKey: artifact.artifactKey,
          revision: artifact.revision,
          payloadHash,
        }), updatedAt: createdAt,
      })
      await db.characterInteractionProductions.update(input.productionId, {
        status: 'building', currentProductReleaseId: null, updatedAt: createdAt,
      })
      return { ...artifact, id: artifactId }
    })
  } catch (error) {
    const failedAt = Date.now()
    await db.characterInteractionProductionSteps.update(stepId, {
      status: 'failed', errorJson: nowError(error), completedAt: failedAt, updatedAt: failedAt,
    })
    await db.characterInteractionProductions.update(input.productionId, { status: 'failed', updatedAt: failedAt })
    throw error
  }
}

async function prepareMediaRows(input: {
  scope: WorkspaceScope
  productionId: number
  bible: CharacterInteractionMediaBibleArtifactV1
  createdAt: number
}): Promise<CharacterInteractionMediaAssetRecordV1[]> {
  return Promise.all(input.bible.slots.map(async slot => {
    const specJson = canonicalStringify({
      schema: 'storyforge.character-interaction-media-slot', version: 1,
      tier: input.bible.tier, style: input.bible.style, slot,
    })
    return {
      projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
      productionId: input.productionId, slotKey: slot.slotKey, assetKey: slot.assetKey, version: 1,
      kind: slot.kind, targetRef: slot.targetRef, productionRequired: slot.required,
      status: 'planned' as const, specJson, specHash: await hashCanonicalValue(parseJson(specJson, 'media.spec')),
      fallbackText: slot.fallbackText, altText: slot.altText,
      blobObjectId: null, mimeType: null, byteSize: 0, contentHash: null, producerRunId: null,
      rightsJson: canonicalStringify({ status: 'unresolved', policyVersion: input.bible.style.rightsPolicyVersion }),
      failureJson: null, createdAt: input.createdAt, updatedAt: input.createdAt,
    }
  }))
}

export async function confirmCharacterInteractionStepCandidateV1(input: {
  scope: WorkspaceScope
  productionId: number
  artifactId: number
  authorNote?: string
}): Promise<CharacterInteractionArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await assertCharacterInteractionFormalProductionReadyV1({ scope, productionId: input.productionId })
  const artifact = await scopedArtifact(scope, input.artifactId)
  if (artifact.productionId !== input.productionId || artifact.status !== 'candidate' || artifact.stepKey == null) fail('候选不可确认')
  const step = await db.characterInteractionProductionSteps.where('productionId').equals(input.productionId)
    .and(row => row.candidateArtifactId === artifact.id && row.status === 'awaiting-confirmation').first()
  if (!step || step.stepKey !== artifact.stepKey) fail('候选没有等待确认的步骤')
  const dependencies = await confirmedArtifacts(input.productionId)
  const required = precedingSteps(artifact.stepKey)
  if (required.some(key => !dependencies.has(key))) fail('确认时前置产物已失效')
  const expectedDependencyHash = await hashCanonicalValue(required.map(key => ({ step: key, hash: dependencies.get(key)!.payloadHash })))
  if (expectedDependencyHash !== artifact.dependencyHash
    || artifact.sourceSelectionHash !== bundle.selection.selectionHash
    || artifact.briefHash !== bundle.briefRecord.briefHash) fail('候选来源或依赖已失效')
  if (artifact.stepKey === 'counterexample-validation') {
    const report = parseJson(artifact.payloadJson, 'validation') as CharacterInteractionValidationArtifactV1
    if (!report.valid) fail('反例验证未通过，不能确认')
  }
  const confirmedAt = Date.now()
  const mediaRows = artifact.stepKey === 'media-bible'
    ? await prepareMediaRows({ scope, productionId: input.productionId, bible: parseJson(artifact.payloadJson, 'mediaBible') as CharacterInteractionMediaBibleArtifactV1, createdAt: confirmedAt })
    : []
  await db.transaction('rw', scopeTransactionTables(
    db.characterInteractionProductions, db.characterInteractionProductionSteps,
    db.characterInteractionArtifacts, db.characterInteractionMediaAssets,
  ), async () => {
    const [currentArtifact, currentStep, currentProduction] = await Promise.all([
      db.characterInteractionArtifacts.get(artifact.id!), db.characterInteractionProductionSteps.get(step.id!),
      db.characterInteractionProductions.get(input.productionId),
    ])
    if (currentArtifact?.status !== 'candidate' || currentStep?.status !== 'awaiting-confirmation'
      || currentProduction?.activeSourceSelectionId !== bundle.sourceRecord.id
      || currentProduction.activeBriefId !== bundle.briefRecord.id) fail('确认提交前候选或生产输入已变化')
    await db.characterInteractionArtifacts.update(artifact.id!, {
      status: 'confirmed', confirmationJson: canonicalStringify({
        authorConfirmed: true, authorNote: input.authorNote?.trim() || '', confirmedAt,
      }), confirmedAt,
    })
    await db.characterInteractionProductionSteps.update(step.id!, {
      status: 'confirmed', confirmedArtifactId: artifact.id!, completedAt: confirmedAt, updatedAt: confirmedAt,
    })
    if (mediaRows.length) {
      const active = await db.characterInteractionMediaAssets.where('productionId').equals(input.productionId)
        .and(row => row.status !== 'superseded').count()
      if (active) fail('确认媒资圣经前已存在活动媒资计划')
      await db.characterInteractionMediaAssets.bulkAdd(mediaRows)
    }
    const finalStep = artifact.stepKey === 'author-preview'
    await db.characterInteractionProductions.update(input.productionId, {
      status: finalStep ? 'preview-ready' : 'building', updatedAt: confirmedAt,
    })
  })
  await refreshCharacterInteractionReleaseReadinessV1({ scope, productionId: input.productionId })
  return (await db.characterInteractionArtifacts.get(artifact.id!))!
}

export async function rejectCharacterInteractionStepCandidateV1(input: {
  scope: WorkspaceScope
  productionId: number
  artifactId: number
  reason: string
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const artifact = await scopedArtifact(scope, input.artifactId)
  const reason = text(input.reason, '拒绝原因', 2_000)
  if (artifact.productionId !== input.productionId || artifact.status !== 'candidate') fail('候选不可拒绝')
  const step = await db.characterInteractionProductionSteps.where('productionId').equals(input.productionId)
    .and(row => row.candidateArtifactId === artifact.id && row.status === 'awaiting-confirmation').first()
  if (!step) fail('候选步骤不存在')
  const now = Date.now()
  await db.transaction('rw', db.characterInteractionArtifacts, db.characterInteractionProductionSteps, async () => {
    await db.characterInteractionArtifacts.update(artifact.id!, { status: 'rejected', confirmationJson: canonicalStringify({ authorRejected: true, reason, rejectedAt: now }) })
    await db.characterInteractionProductionSteps.update(step.id!, { status: 'rejected', errorJson: canonicalStringify({ reason }), completedAt: now, updatedAt: now })
  })
}

export async function attachCharacterInteractionMediaAssetV1(input: {
  scope: WorkspaceScope
  productionId: number
  slotKey: string
  expectedSpecHash: string
  data: ArrayBuffer
  mimeType: string
  producerRunId?: number | null
  rights: { sourceKind: 'provider-generated' | 'author-owned-import'; license: string; attribution?: string; authorConfirmed: boolean }
}): Promise<CharacterInteractionMediaAssetRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await loadCharacterInteractionProductionV1({ scope, productionId: input.productionId })
  if (['released', 'archived'].includes(production.production.status)) fail('已发布或归档生产不能修改媒资')
  if (!input.rights.authorConfirmed || !input.rights.license.trim()) fail('媒资权利必须由作者确认')
  const current = await db.characterInteractionMediaAssets.where('[productionId+slotKey]').equals([input.productionId, input.slotKey])
    .and(row => row.status !== 'superseded').last()
  if (!current || current.specHash !== input.expectedSpecHash) fail('媒资槽不存在或规格已变化')
  const mimeType = input.mimeType.trim().toLowerCase()
  const detectedMimeType = detectGameMediaMimeTypeV1(input.data)
  if (!detectedMimeType || detectedMimeType !== mimeType) fail('媒资声明 MIME 与真实字节签名不一致')
  if (current.kind === 'portrait' && !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) fail('角色立绘 MIME 无效')
  if (current.kind === 'portrait' && !detectGameImageDimensionsV1(input.data)) fail('角色立绘尺寸或图片结构无效')
  if (current.kind === 'voice-sample' && !['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(mimeType)) fail('角色语音 MIME 无效')
  const object = await putMediaBlobObject({ scope, data: input.data, mimeType })
  const updatedAt = Date.now()
  const updated = await db.characterInteractionMediaAssets.update(current.id!, {
    status: 'available', blobObjectId: object.id!, mimeType: object.mimeType,
    byteSize: object.byteSize, contentHash: object.contentHash, producerRunId: input.producerRunId ?? null,
    rightsJson: canonicalStringify(input.rights), failureJson: null, updatedAt,
  })
  if (updated !== 1) fail('媒资绑定失败')
  await refreshCharacterInteractionReleaseReadinessV1({ scope, productionId: input.productionId })
  return (await db.characterInteractionMediaAssets.get(current.id!))!
}

export async function degradeCharacterInteractionMediaAssetV1(input: {
  scope: WorkspaceScope
  productionId: number
  slotKey: string
  expectedSpecHash: string
  reason: string
}): Promise<CharacterInteractionMediaAssetRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const reason = text(input.reason, '降级原因', 2_000)
  const current = await db.characterInteractionMediaAssets.where('[productionId+slotKey]').equals([input.productionId, input.slotKey])
    .and(row => row.status !== 'superseded').last()
  if (!current || current.specHash !== input.expectedSpecHash || !current.fallbackText.trim()) fail('媒资槽不可降级')
  const updatedAt = Date.now()
  await db.characterInteractionMediaAssets.update(current.id!, {
    status: 'degraded', blobObjectId: null, mimeType: null, byteSize: 0, contentHash: null,
    failureJson: canonicalStringify({ explicitAuthorDegrade: true, reason, degradedAt: updatedAt }), updatedAt,
  })
  await refreshCharacterInteractionReleaseReadinessV1({ scope, productionId: input.productionId })
  return (await db.characterInteractionMediaAssets.get(current.id!))!
}

export async function verifyCharacterInteractionMediaCoverageV1(input: {
  scope: WorkspaceScope
  productionId: number
  verifyBytes?: boolean
}): Promise<{ ready: boolean; missingRequiredSlotKeys: string[]; assets: CharacterInteractionMediaAssetRecordV1[]; manifestHash: string }> {
  const scope = await resolveScope({ scope: input.scope })
  const rows = await db.characterInteractionMediaAssets.where('productionId').equals(input.productionId).toArray()
  const active = rows.filter(row => row.status !== 'superseded')
  const latest = new Map<string, CharacterInteractionMediaAssetRecordV1>()
  for (const row of active.sort((a, b) => a.version - b.version)) latest.set(row.slotKey, row)
  const assets = [...latest.values()].sort((a, b) => a.slotKey.localeCompare(b.slotKey))
  const missingRequiredSlotKeys: string[] = []
  for (const asset of assets) {
    if (asset.status === 'available') {
      if (!asset.blobObjectId || !asset.contentHash || !asset.mimeType || asset.byteSize < 1) missingRequiredSlotKeys.push(asset.slotKey)
      else if (input.verifyBytes) await readMediaBlobObjectData({
        scope, blobObjectId: asset.blobObjectId,
        expected: { contentHash: asset.contentHash, byteSize: asset.byteSize, mimeType: asset.mimeType },
      })
    } else if (asset.productionRequired && asset.status !== 'degraded') missingRequiredSlotKeys.push(asset.slotKey)
    if (asset.status === 'degraded') {
      const failure = record(parseJson(asset.failureJson ?? '{}', 'media.failure'), 'media.failure')
      if (failure.explicitAuthorDegrade !== true || !asset.fallbackText.trim()) missingRequiredSlotKeys.push(asset.slotKey)
    }
  }
  const manifestHash = await hashCanonicalValue(assets.map(asset => ({
    slotKey: asset.slotKey, assetKey: asset.assetKey, kind: asset.kind, required: asset.productionRequired,
    status: asset.status, specHash: asset.specHash, contentHash: asset.contentHash,
    mimeType: asset.mimeType, byteSize: asset.byteSize, fallbackText: asset.fallbackText,
  })))
  return { ready: missingRequiredSlotKeys.length === 0, missingRequiredSlotKeys: unique(missingRequiredSlotKeys), assets, manifestHash }
}

async function allStepsConfirmed(productionId: number): Promise<boolean> {
  const rows = await db.characterInteractionProductionSteps.where('productionId').equals(productionId).toArray()
  return CHARACTER_INTERACTION_PRODUCTION_STEPS_V1.every(step => rows.some(row => row.stepKey === step && row.status === 'confirmed'))
}

export async function refreshCharacterInteractionReleaseReadinessV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<boolean> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.characterInteractionProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'characterInteractionProductions', production, { owner: 'work' })) fail('生产不存在或跨 Work')
  if (['released', 'archived'].includes(production.status)) return production.status === 'released'
  const [confirmed, media] = await Promise.all([
    allStepsConfirmed(input.productionId),
    verifyCharacterInteractionMediaCoverageV1({ scope, productionId: input.productionId }),
  ])
  const ready = confirmed && media.ready
  if (confirmed) await db.characterInteractionProductions.update(input.productionId, { status: ready ? 'release-ready' : 'preview-ready', updatedAt: Date.now() })
  return ready
}

function runtimeSelectionAdapter(
  selection: CharacterInteractionWorldSourceSelectionV1,
  sceneKeys: string[],
): WorldGameSourceSelectionV2 {
  const ids = (table: string) => selection.recordSelections.find(item => item.table === table)?.exportIds ?? []
  return {
    schema: 'storyforge.world-game-source', version: 2, productType: 'character-interaction',
    worldContentHash: selection.worldContentHash,
    narrativeModuleExportIds: ids('narrativeModules'),
    characterExportIds: [...selection.participantCharacterExportIds],
    characterRelationExportIds: ids('characterRelations'), importantLocationExportIds: ids('importantLocations'),
    artifactExportIds: [], codexEntryExportIds: ids('codexEntries'), storyArcExportIds: ids('storyArcs'),
    avgMediaAssetExportIds: [],
    productSource: { kind: 'character-interaction', participantCharacterExportIds: [...selection.participantCharacterExportIds], sceneKeys },
  }
}

function runtimeNarrative(
  title: string,
  integrated: CharacterInteractionIntegrationArtifactV1,
): GameRuntimePackageV2['narrative'] {
  const sceneNodes = integrated.sceneTemplates.map((scene, index) => ({
    key: `narrative.${scene.sceneKey}`, kind: index === 0 ? 'entry' as const : 'scene' as const,
    title: scene.title, summary: scene.purpose, conditionJson: '{}', effectsJson: '[]',
    successorKeys: [index === integrated.sceneTemplates.length - 1 ? 'narrative.ending' : `narrative.${integrated.sceneTemplates[index + 1].sceneKey}`],
  }))
  const nodes: GameRuntimePackageV2['narrative']['nodes'] = [...sceneNodes, {
    key: 'narrative.ending', kind: 'ending', title: '互动暂告一段落', summary: '玩家可创建新会话或从检查点分支。',
    conditionJson: '{}', effectsJson: '[]', successorKeys: [],
  }]
  const beats = integrated.sceneTemplates.map((scene, index) => ({
    beatKey: `beat.${scene.sceneKey}.opening`, nodeKey: `narrative.${scene.sceneKey}`,
    kind: 'narration' as const, speakerKey: null, text: `${scene.timeLabel}，${scene.location}。${scene.purpose}`, order: index,
  }))
  const choices = integrated.sceneTemplates.map((scene, index) => ({
    choiceKey: `choice.${scene.sceneKey}.continue`, sourceNodeKey: `narrative.${scene.sceneKey}`,
    text: index === integrated.sceneTemplates.length - 1 ? '结束本次互动' : '进入下一场景',
    description: '', unavailableReason: '',
    targetNodeKey: index === integrated.sceneTemplates.length - 1 ? 'narrative.ending' : `narrative.${integrated.sceneTemplates[index + 1].sceneKey}`,
    displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: index,
  }))
  return { moduleKind: 'main', moduleTitle: title, entryNodeKey: sceneNodes[0].key, nodes, beats, choices }
}

const FORMAL_AI_STEP_KEYS_V1 = [
  'character-capsules',
  'scene-plan',
  'media-bible',
] as const satisfies readonly CharacterInteractionProductionStepKeyV1[]
const FORMAL_PRODUCTION_AGENT_STEP_ID_V1 = 'character-interaction:production-candidate'

async function exactProductionContextAttemptsV1(input: {
  scope: WorkspaceScope
  confirmed: Map<CharacterInteractionProductionStepKeyV1, CharacterInteractionArtifactRecordV1>
}): Promise<LocalContextManifestAttemptV1[]> {
  const attempts: LocalContextManifestAttemptV1[] = []
  for (const stepKey of FORMAL_AI_STEP_KEYS_V1) {
    const artifact = input.confirmed.get(stepKey) ?? fail(`缺少正式 AI 生产产物:${stepKey}`)
    if (artifact.producerRunId == null) fail(`${stepKey} 没有 durable producerRun，不能正式发布`)
    const snapshot = await readAgentRunV1(input.scope, artifact.producerRunId)
    const run = snapshot.run
    if (run.projectId !== input.scope.projectId) fail(`${stepKey} producerRun 不属于当前项目`)
    const events = snapshot.events
    const candidate = events.find(event => event.type === 'candidate.persisted'
      && event.payload.stepId === FORMAL_PRODUCTION_AGENT_STEP_ID_V1
      && event.payload.candidateHash === artifact.payloadHash)
    if (!candidate || candidate.type !== 'candidate.persisted') fail(`${stepKey} 缺少与已确认产物一致的 candidate.persisted`)
    await verifyContextGatewayCandidateEvidenceV1({
      scope: input.scope,
      runId: run.id!,
      stepId: FORMAL_PRODUCTION_AGENT_STEP_ID_V1,
      attempt: candidate.payload.attempt,
      candidateHash: artifact.payloadHash,
    })
    const contexts = events.filter((event): event is Extract<typeof event, { type: 'context.assembled' }> => (
      event.type === 'context.assembled'
        && event.payload.stepId === FORMAL_PRODUCTION_AGENT_STEP_ID_V1
    ))
    if (!contexts.length) fail(`${stepKey} 缺少 ContextManifestV3`)
    attempts.push(...contexts.map(event => ({
      runId: run.id!,
      stepId: event.payload.stepId,
      attempt: event.payload.attempt,
      manifestHash: event.payload.manifestHash,
    })))
  }
  const unique = new Set(attempts.map(item => `${item.runId}:${item.stepId}:${item.attempt}`))
  if (unique.size !== attempts.length) fail('生产 ContextManifest attempt 重复')
  return attempts
}

async function parentCharacterProductLineageV1(
  prior: CharacterInteractionProductReleaseRecordV1[],
): Promise<ProductReleaseLineageV1 | null> {
  if (!prior.length) return null
  const latest = [...prior].sort((left, right) => right.version - left.version)[0]!
  if (!latest.lineageJson || !latest.lineageHash || !latest.releaseUid) {
    fail('上一 ProductRelease 是无 lineage 的旧版；必须先显式迁移，不能静默继承')
  }
  const lineage = await validateProductReleaseLineageV1(
    parseJson(latest.lineageJson, 'parent ProductRelease lineage') as ProductReleaseLineageV1,
  )
  if (lineage.lineageHash !== latest.lineageHash || lineage.releaseUid !== latest.releaseUid
    || lineage.releaseHash !== latest.contentHash) fail('上一 ProductRelease lineage 与记录不一致')
  return lineage
}

export async function publishCharacterInteractionProductReleaseV1(input: {
  scope: WorkspaceScope
  productionId: number
  label?: string
}): Promise<{ productRelease: CharacterInteractionProductReleaseRecordV1; gameRelease: GameRelease }> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await assertCharacterInteractionFormalProductionReadyV1({ scope, productionId: input.productionId })
  if (bundle.production.status !== 'release-ready') fail('生产尚未达到 release-ready')
  if (!await allStepsConfirmed(input.productionId)) fail('仍有生产步骤未确认')
  const confirmed = await confirmedArtifacts(input.productionId)
  const integrated = payload<CharacterInteractionIntegrationArtifactV1>(confirmed, 'integration')
  const validation = payload<CharacterInteractionValidationArtifactV1>(confirmed, 'counterexample-validation')
  if (!validation.valid) fail('反例验证未通过')
  const media = await verifyCharacterInteractionMediaCoverageV1({ scope, productionId: input.productionId, verifyBytes: true })
  if (!media.ready) fail(`必需媒资未完成或未显式降级:${media.missingRequiredSlotKeys.join('、')}`)
  const runtimePackage = parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'character-interaction',
    definition: {
      gameKey: bundle.production.productionKey, title: bundle.production.title,
      description: bundle.brief.userInstruction, enabledCapabilities: ['narrative', 'interaction'],
      rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: bundle.selection.worldContentHash,
      selection: runtimeSelectionAdapter(bundle.selection, integrated.sceneTemplates.map(scene => scene.sceneKey)),
    },
    narrative: runtimeNarrative(bundle.production.title, integrated),
    interaction: { playerKey: 'player', profiles: integrated.profiles, sceneTemplates: integrated.sceneTemplates },
  } satisfies GameRuntimePackageV2)
  if (!bundle.worldReference || !bundle.sourcePlan || !bundle.confirmedBriefContract) {
    fail('正式发布缺少 WorldReference/SourcePlan/ConfirmedBrief')
  }
  const worldReference = bundle.worldReference
  const sourcePlan = bundle.sourcePlan
  const confirmedBriefContract = bundle.confirmedBriefContract
  const artifacts = [...confirmed.values()].sort((a, b) => (STEP_INDEX.get(a.stepKey!) ?? 0) - (STEP_INDEX.get(b.stepKey!) ?? 0))
  const artifactManifestHash = await hashCanonicalValue(artifacts.map(item => ({ artifactKey: item.artifactKey, kind: item.kind, payloadHash: item.payloadHash })))
  const sourceManifest = await aggregateProductSourceManifestFromExactRunsV1({
    scope,
    sourcePlan,
    runContextManifests: await exactProductionContextAttemptsV1({ scope, confirmed }),
  })
  const releaseInputHash = await hashCanonicalValue({
    sourceSelectionHash: bundle.selection.selectionHash, briefHash: bundle.briefRecord.briefHash,
    sourceManifestHash: sourceManifest.manifestHash,
    artifactManifestHash, mediaManifestHash: media.manifestHash,
  })
  const priorReleases = await db.characterInteractionProductReleases.where('productionId').equals(input.productionId).toArray()
  const parentLineage = await parentCharacterProductLineageV1(priorReleases)
  const version = Math.max(0, ...priorReleases.map(item => item.version)) + 1
  const releaseManifestV2 = await createGameReleaseManifestV2({
    runtimePackage,
    productionProvenance: {
      productionKey: bundle.production.productionKey,
      buildNumber: version,
      buildManifestHash: releaseInputHash,
      rootTerminalReceiptHash: confirmed.get('counterexample-validation')!.payloadHash,
    },
  })
  const gameReleaseHash = await hashGameProductionValueV2(releaseManifestV2)
  const createdAt = Date.now()
  const manifest: CharacterInteractionProductReleaseManifestV1 = {
    schema: 'storyforge.character-interaction-product-release', version: 1,
    productType: 'character-interaction', releaseVersion: version,
    source: {
      worldReleaseId: bundle.selection.worldReleaseId, worldContentHash: bundle.selection.worldContentHash,
      selectionHash: bundle.selection.selectionHash, selection: bundle.selection,
    },
    brief: { content: bundle.brief, contentHash: bundle.briefRecord.briefHash },
    sourceContracts: {
      worldReferenceHash: worldReference.referenceHash,
      sourcePlanHash: sourcePlan.planHash,
      sourceManifestHash: sourceManifest.manifestHash,
      confirmedBriefHash: confirmedBriefContract.confirmationHash,
    },
    artifacts: artifacts.map(item => ({
      artifactKey: item.artifactKey, kind: item.kind,
      payload: parseJson(item.payloadJson, item.artifactKey), payloadHash: item.payloadHash,
    })),
    media: media.assets.filter(item => item.status === 'available' || item.status === 'degraded').map(item => ({
      slotKey: item.slotKey, assetKey: item.assetKey, kind: item.kind,
      status: item.status as 'available' | 'degraded', required: item.productionRequired,
      specHash: item.specHash, fallbackText: item.fallbackText, contentHash: item.contentHash,
      mimeType: item.mimeType, byteSize: item.byteSize,
    })),
    gameRelease: { contentHash: gameReleaseHash },
    integrity: { artifactManifestHash, mediaManifestHash: media.manifestHash, releaseInputHash },
    compatibility: { productionContract: 1, runtimeProtocol: 1, minimumPlayerVersion: 1 },
    createdAt,
  }
  const contentHash = await hashCharacterInteractionProductReleaseManifestV1(manifest)
  const releaseUid = productReleaseUidV1({
    productType: 'character-interaction',
    productInstanceKey: bundle.production.productionKey,
    releaseVersion: version,
    releaseHash: contentHash,
  })
  const lineage = await createProductReleaseLineageV1({
    productType: 'character-interaction',
    productInstanceKey: bundle.production.productionKey,
    releaseUid,
    releaseVersion: version,
    releaseHash: contentHash,
    parentRelease: parentLineage == null ? null : {
      releaseUid: parentLineage.releaseUid,
      releaseHash: parentLineage.releaseHash,
    },
    worldReference,
    sourcePlan,
    sourceManifest,
    confirmedBrief: confirmedBriefContract,
    build: { buildUid: `character-interaction-build:${releaseInputHash}`, buildHash: releaseInputHash },
    quality: {
      passed: true,
      receiptHashes: [confirmed.get('counterexample-validation')!.payloadHash, media.manifestHash],
    },
    compatibility: {
      status: version === 1 ? 'initial' : 'compatible',
      protocolVersion: 1,
      evidenceHashes: [releaseInputHash, gameReleaseHash],
    },
    createdAt,
  })
  return db.transaction('rw', scopeTransactionTables(
    db.characterInteractionProductions, db.characterInteractionSourceSelections,
    db.characterInteractionBriefs, db.characterInteractionProductionSteps,
    db.characterInteractionArtifacts, db.characterInteractionMediaAssets,
    db.characterInteractionProductReleases, db.gameReleases, db.worldReleases, db.mediaBlobObjects,
  ), async () => {
    const [currentProduction, currentSource, currentBrief, worldRelease] = await Promise.all([
      db.characterInteractionProductions.get(input.productionId), db.characterInteractionSourceSelections.get(bundle.sourceRecord.id),
      db.characterInteractionBriefs.get(bundle.briefRecord.id), db.worldReleases.get(bundle.selection.worldReleaseId),
    ])
    if (!currentProduction || currentProduction.status !== 'release-ready'
      || currentProduction.activeSourceSelectionId !== bundle.sourceRecord.id
      || currentProduction.activeBriefId !== bundle.briefRecord.id
      || currentSource?.selectionHash !== bundle.selection.selectionHash
      || currentSource?.sourcePlanHash !== sourcePlan.planHash
      || currentBrief?.briefHash !== bundle.briefRecord.briefHash
      || currentBrief?.confirmedContractHash !== confirmedBriefContract.confirmationHash
      || worldRelease?.contentHash !== bundle.selection.worldContentHash) fail('发布提交前来源、Brief 或 WorldRelease 已变化')
    const prior = await db.characterInteractionProductReleases.where('productionId').equals(input.productionId).toArray()
    if (Math.max(0, ...prior.map(item => item.version)) + 1 !== version) fail('发布提交前 ProductRelease version 已变化')
    const currentArtifacts = await db.characterInteractionArtifacts.where('productionId').equals(input.productionId).toArray()
    for (const artifact of artifacts) {
      const current = currentArtifacts.find(item => item.id === artifact.id)
      if (!current || current.status !== 'confirmed' || current.payloadHash !== artifact.payloadHash
        || current.producerRunId !== artifact.producerRunId) fail(`发布提交前产物已变化:${artifact.artifactKey}`)
    }
    const existingGame = await db.gameReleases.where('contentHash').equals(gameReleaseHash).first()
    let gameRelease: GameRelease
    if (existingGame) gameRelease = existingGame
    else {
      const row: GameRelease = {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        gameDefinitionId: null, worldReleaseId: bundle.selection.worldReleaseId, version,
        label: input.label?.trim() || `${bundle.production.title} v${version}`,
        manifestJson: canonicalStringify(releaseManifestV2), contentHash: gameReleaseHash, createdAt,
      }
      const id = await db.gameReleases.add(row) as number
      gameRelease = { ...row, id }
    }
    const row: CharacterInteractionProductReleaseRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: input.productionId, sourceSelectionId: bundle.sourceRecord.id,
      sourceWorldReleaseId: bundle.selection.worldReleaseId, briefId: bundle.briefRecord.id,
      gameReleaseId: gameRelease.id!, version,
      label: input.label?.trim() || `${bundle.production.title} v${version}`,
      manifestJson: canonicalStringify(manifest), contentHash, releaseUid,
      sourceManifestJson: canonicalStringify(sourceManifest),
      sourceManifestHash: sourceManifest.manifestHash,
      lineageJson: canonicalStringify(lineage), lineageHash: lineage.lineageHash,
      createdAt,
    }
    const id = await db.characterInteractionProductReleases.add(row) as number
    await db.characterInteractionProductions.update(input.productionId, {
      status: 'released', currentProductReleaseId: id, updatedAt: createdAt,
    })
    return { productRelease: { ...row, id }, gameRelease }
  })
}

export async function assertCharacterInteractionProductReleaseUnchangedV1(input: {
  scope: WorkspaceScope
  productReleaseId: number
}): Promise<CharacterInteractionProductReleaseManifestV1> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.characterInteractionProductReleases.get(input.productReleaseId)
  if (!row || !await assertRecordInScope(scope, 'characterInteractionProductReleases', row, { owner: 'work' })) fail('Product Release 不存在或跨 Work')
  const manifest = parseJson(row.manifestJson, 'ProductRelease') as CharacterInteractionProductReleaseManifestV1
  if (manifest.schema !== 'storyforge.character-interaction-product-release' || manifest.version !== 1
    || manifest.productType !== 'character-interaction' || await hashCharacterInteractionProductReleaseManifestV1(manifest) !== row.contentHash) fail('Product Release 已损坏')
  if (!row.releaseUid || !row.sourceManifestJson || !row.sourceManifestHash || !row.lineageJson || !row.lineageHash) {
    fail('Product Release 缺少 SourceManifest/Lineage；旧版必须先显式迁移')
  }
  const [gameRelease, worldRelease, sourceRecord, briefRecord] = await Promise.all([
    db.gameReleases.get(row.gameReleaseId),
    db.worldReleases.get(row.sourceWorldReleaseId),
    db.characterInteractionSourceSelections.get(row.sourceSelectionId),
    db.characterInteractionBriefs.get(row.briefId),
  ])
  if (!gameRelease || gameRelease.contentHash !== manifest.gameRelease.contentHash
    || !worldRelease || worldRelease.contentHash !== manifest.source.worldContentHash) fail('Product Release 来源引用已损坏')
  if (!sourceRecord?.sourcePlanJson || !briefRecord?.confirmedContractJson) fail('Product Release 上游契约已丢失')
  const sourcePlan = parseJson(sourceRecord.sourcePlanJson, 'ProductSourcePlan') as ProductSourcePlanV1
  const confirmedBrief = parseJson(briefRecord.confirmedContractJson, 'ConfirmedProductBrief') as ConfirmedProductBriefV1
  await validateConfirmedProductBriefV1({ brief: confirmedBrief, sourcePlan })
  const sourceManifest = await validateProductSourceManifestV1({
    sourceManifest: parseJson(row.sourceManifestJson, 'ProductSourceManifest') as ProductSourceManifestV1,
    sourcePlan,
  })
  const lineage = await validateProductReleaseLineageV1(
    parseJson(row.lineageJson, 'ProductReleaseLineage') as ProductReleaseLineageV1,
  )
  if (row.releaseUid !== lineage.releaseUid || row.contentHash !== lineage.releaseHash
    || row.sourceManifestHash !== sourceManifest.manifestHash || row.lineageHash !== lineage.lineageHash
    || manifest.sourceContracts.sourcePlanHash !== sourcePlan.planHash
    || manifest.sourceContracts.sourceManifestHash !== sourceManifest.manifestHash
    || manifest.sourceContracts.confirmedBriefHash !== confirmedBrief.confirmationHash
    || manifest.sourceContracts.worldReferenceHash !== sourcePlan.worldReference.referenceHash) {
    fail('Product Release 五项契约链已损坏')
  }
  for (const artifact of manifest.artifacts) if (await hashCanonicalValue(artifact.payload) !== artifact.payloadHash) fail(`Product Release 产物损坏:${artifact.artifactKey}`)
  return structuredClone(manifest)
}

/** New WorldRelease never mutates the old binding; this only prepares an explicit fork plan. */
export async function prepareCharacterInteractionWorldUpgradeCandidateV1(input: {
  scope: WorkspaceScope
  productionId: number
  newWorldReleaseId: number
}): Promise<CharacterInteractionArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const bundle = await loadCharacterInteractionProductionV1({ scope, productionId: input.productionId })
  if (input.newWorldReleaseId === bundle.selection.worldReleaseId) fail('新 WorldRelease 与当前版本相同')
  const nextCatalog = await loadCharacterInteractionWorldSourceCatalogV1({ scope, worldReleaseId: input.newWorldReleaseId })
  const oldNames = new Map((bundle.catalog.records.characters ?? []).map(item => [item.exportId, item.label]))
  const candidates = bundle.selection.participantCharacterExportIds.map(oldExportId => {
    const name = oldNames.get(oldExportId) ?? ''
    const matches = (nextCatalog.records.characters ?? []).filter(item => item.label === name)
    return { oldExportId, name, newExportId: matches.length === 1 ? matches[0].exportId : null, ambiguous: matches.length > 1 }
  })
  const body = {
    schema: 'storyforge.character-interaction-world-upgrade-plan', version: 1,
    from: { worldReleaseId: bundle.selection.worldReleaseId, worldContentHash: bundle.selection.worldContentHash },
    to: { worldReleaseId: input.newWorldReleaseId, worldContentHash: nextCatalog.worldContentHash },
    participantMappings: candidates,
    unresolved: candidates.filter(item => item.newExportId == null).map(item => item.oldExportId),
    action: 'create-new-production' as const,
  }
  const payloadHash = await hashCharacterInteractionArtifactPayloadV1('world-upgrade-plan', body)
  const existing = await db.characterInteractionArtifacts.where('productionId').equals(input.productionId).toArray()
  const rows = existing.filter(item => item.artifactKey === `world-upgrade:${nextCatalog.worldContentHash}`)
  const createdAt = Date.now()
  const row: CharacterInteractionArtifactRecordV1 = {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId: input.productionId, stepKey: null,
    artifactKey: `world-upgrade:${nextCatalog.worldContentHash}`,
    revision: Math.max(0, ...rows.map(item => item.revision)) + 1,
    kind: 'world-upgrade-plan', status: 'candidate', sourceSelectionHash: bundle.selection.selectionHash,
    briefHash: bundle.briefRecord.briefHash, dependencyHash: bundle.selection.selectionHash,
    payloadJson: canonicalStringify(body), payloadHash, producerRunId: null, sourceSessionId: null,
    confirmationJson: null, createdAt, confirmedAt: null,
  }
  const id = await db.characterInteractionArtifacts.add(row) as number
  return { ...row, id }
}

export async function applyCharacterInteractionWorldUpgradeV1(input: {
  scope: WorkspaceScope
  productionId: number
  upgradeArtifactId: number
  productionKey: string
  participantCharacterExportIds?: number[]
}): Promise<CharacterInteractionProductionBundleV1> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await loadCharacterInteractionProductionV1({ scope, productionId: input.productionId })
  const artifact = await scopedArtifact(scope, input.upgradeArtifactId)
  if (artifact.productionId !== input.productionId || artifact.kind !== 'world-upgrade-plan' || artifact.status !== 'candidate') fail('升级候选不可应用')
  const plan = record(parseJson(artifact.payloadJson, 'upgradePlan'), 'upgradePlan')
  const to = record(plan.to, 'upgradePlan.to')
  const mappings = Array.isArray(plan.participantMappings) ? plan.participantMappings.map(item => record(item, 'participantMapping')) : []
  const participantCharacterExportIds = input.participantCharacterExportIds ?? mappings.map(item => Number(item.newExportId)).filter(Number.isInteger)
  if (!participantCharacterExportIds.length || participantCharacterExportIds.length !== current.selection.participantCharacterExportIds.length) fail('升级角色映射尚未完整确认')
  const briefInput: CharacterInteractionBriefInputV1 = {
    title: `${current.brief.title}（升级）`, userInstruction: current.brief.userInstruction,
    userRole: current.brief.userRole, guests: structuredClone(current.brief.guests),
    storyMode: current.brief.setting.storyMode, timeContext: current.brief.setting.timeContext,
    locationContext: current.brief.setting.locationContext, historicalContext: current.brief.setting.historicalContext,
    chatGoal: current.brief.setting.chatGoal, desiredDirections: [...current.brief.setting.desiredDirections],
    safetyBoundaries: [...current.brief.setting.safetyBoundaries], publicKnowledge: [...current.brief.knowledgePolicy.publicKnowledge],
    privateKnowledge: [...current.brief.knowledgePolicy.privateKnowledge], prohibitedDisclosure: [...current.brief.knowledgePolicy.prohibitedDisclosure],
    relationshipDimensions: [...current.brief.relationshipPolicy.dimensions], sceneCount: current.brief.runtime.sceneCount,
    maxTurnsPerScene: current.brief.runtime.maxTurnsPerScene, directorBudget: current.brief.runtime.directorBudget,
    endingStrategy: current.brief.runtime.endingStrategy, mediaTier: current.brief.media.tier,
    allowWorldFeedbackCandidate: current.brief.worldFeedback.allowCandidate,
  }
  const created = await createCharacterInteractionProductionV1({
    scope, productionKey: stableKey(input.productionKey, 'productionKey'),
    worldReleaseId: Number(to.worldReleaseId), participantCharacterExportIds, brief: briefInput,
  })
  await db.characterInteractionArtifacts.update(artifact.id!, {
    status: 'confirmed', confirmationJson: canonicalStringify({ authorConfirmed: true, createdProductionKey: created.production.productionKey, confirmedAt: Date.now() }), confirmedAt: Date.now(),
  })
  return created
}

/** Runtime facts become a product candidate only; no World table or adopt() call occurs here. */
export async function createCharacterInteractionWorldFeedbackCandidateV1(input: {
  scope: WorkspaceScope
  simulationSessionId: number
  authorInstruction: string
}): Promise<CharacterInteractionArtifactRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.kind !== 'chatgame' || session.projectId !== scope.projectId
    || session.worldId !== scope.worldId || session.workId !== scope.workId || session.gameReleaseId == null) fail('角色互动 Instance 不存在或跨 Work')
  const productRelease = await db.characterInteractionProductReleases.where('gameReleaseId').equals(session.gameReleaseId).first()
  if (!productRelease) fail('Instance 不是由角色互动 Product Release 创建')
  const production = await loadCharacterInteractionProductionV1({ scope, productionId: productRelease.productionId })
  if (!production.brief.worldFeedback.allowCandidate) fail('Brief 未授权形成世界反馈候选')
  const [state, events] = await Promise.all([
    readSimulationState(input.simulationSessionId),
    db.simulationEvents.where('sessionId').equals(input.simulationSessionId).sortBy('sequence'),
  ])
  const body = {
    schema: 'storyforge.character-interaction-world-feedback-candidate', version: 1,
    productReleaseHash: productRelease.contentHash, sourceWorldContentHash: production.selection.worldContentHash,
    authorInstruction: text(input.authorInstruction, '作者指令', 4_000),
    evidence: {
      sessionRuntimeSourceHash: session.runtimeSourceHash,
      throughSequence: state.lastSequence,
      acceptedMemories: state.interaction?.memories.filter(item => item.status === 'accepted').map(item => ({
        participantKey: item.participantKey, kind: item.kind, content: item.content,
        sourceEventSequences: item.sourceEventSequences, evidenceExcerpt: item.evidenceExcerpt,
      })) ?? [],
      relationships: state.interaction?.relationships ?? [],
      resolvedThreads: state.interaction?.threads.filter(item => item.status === 'resolved') ?? [],
      eventHashes: await Promise.all(events.map(event => hashCanonicalValue(portableEventEvidence(event)))),
    },
    governance: { autoWriteback: false, requiresAuthorAdopt: true, targetWorldRevision: 'new-only' },
  }
  const payloadHash = await hashCanonicalValue(body)
  const rows = await db.characterInteractionArtifacts.where('productionId').equals(productRelease.productionId).toArray()
  const sourceSessionKey = session.runtimeSourceHash || await hashCanonicalValue({
    kind: session.kind, seed: session.seed, title: session.title, createdAt: session.createdAt,
  })
  const artifactKey = `world-feedback:${sourceSessionKey}`
  const createdAt = Date.now()
  const row: CharacterInteractionArtifactRecordV1 = {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId: productRelease.productionId, stepKey: null, artifactKey,
    revision: Math.max(0, ...rows.filter(item => item.artifactKey === artifactKey).map(item => item.revision)) + 1,
    kind: 'world-feedback-candidate', status: 'candidate',
    sourceSelectionHash: production.selection.selectionHash, briefHash: production.briefRecord.briefHash,
    dependencyHash: productRelease.contentHash, payloadJson: canonicalStringify(body), payloadHash,
    producerRunId: null, sourceSessionId: input.simulationSessionId,
    confirmationJson: null, createdAt, confirmedAt: null,
  }
  const id = await db.characterInteractionArtifacts.add(row) as number
  return { ...row, id }
}

function portableEventEvidence(event: SimulationEvent): unknown {
  return { sequence: event.sequence, type: event.type, payloadJson: event.payloadJson, createdAt: event.createdAt }
}

export async function recoverInterruptedCharacterInteractionProductionsV1(scopeInput: WorkspaceScope): Promise<number[]> {
  const scope = await resolveScope({ scope: scopeInput })
  const running = await db.characterInteractionProductionSteps.where('workId').equals(scope.workId)
    .and(row => row.projectId === scope.projectId && row.worldId === scope.worldId && row.status === 'running').toArray()
  const recovered: number[] = []
  for (const step of running) {
    const now = Date.now()
    const errorJson = canonicalStringify({ code: 'interrupted', message: '上次生产未完成；可由作者显式重试。', recoveredAt: now })
    await db.transaction('rw', db.characterInteractionProductionSteps, db.characterInteractionProductions, async () => {
      const current = await db.characterInteractionProductionSteps.get(step.id!)
      if (!current || current.status !== 'running') return
      await db.characterInteractionProductionSteps.update(current.id!, { status: 'failed', errorJson, completedAt: now, updatedAt: now })
      const production = await db.characterInteractionProductions.get(current.productionId)
      if (production && production.status === 'building') await db.characterInteractionProductions.update(production.id!, { status: 'failed', updatedAt: now })
      recovered.push(current.id!)
    })
  }
  return recovered
}

/** Frozen-record audit helper used by counterexample tests; never reads live authoring tables. */
export async function inspectCharacterInteractionFrozenProductionRowsV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<ReturnType<typeof readCharacterInteractionSelectedWorldRowsV1>> {
  const bundle = await assertCharacterInteractionFormalProductionReadyV1(input)
  return readCharacterInteractionSelectedWorldRowsV1({ scope: input.scope, selection: bundle.selection })
}
