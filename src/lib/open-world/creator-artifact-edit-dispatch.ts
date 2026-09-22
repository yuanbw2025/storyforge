import {
  TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1,
  type TextOpenWorldAuthorRepairTaskKeyV1,
} from '../product-production/recovery-policy'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../product-production/hash'
import type { ProductBuildArtifactKindV1 } from '../types'
import {
  TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1,
  TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1,
  hashTextOpenWorldCreatorEditPatchV1,
  parseTextOpenWorldCreatorEditFieldV1,
  parseTextOpenWorldCreatorEditPatchV1,
  type TextOpenWorldCreatorEditableArtifactKindV1,
  type TextOpenWorldCreatorEditFieldV1,
  type TextOpenWorldCreatorEditPatchV1,
  type TextOpenWorldCreatorEditValueKindV1,
} from './creator-artifact-edit-contract'
import {
  rebuildTextOpenWorldCraftingEconomyCatalogFromAuthorEditableDraftV1,
  projectTextOpenWorldCraftingEconomyCatalogAuthorEditableDraftV1,
} from './crafting-economy-catalog-production'
import {
  rebuildTextOpenWorldEncounterCatalogFromAuthorEditableDraftV1,
  projectTextOpenWorldEncounterCatalogAuthorEditableDraftV1,
} from './encounter-catalog-production'
import {
  rebuildTextOpenWorldExperienceFromAuthorEditableDraftV1,
  projectTextOpenWorldExperienceAuthorEditableDraftV1,
} from './experience-design'
import {
  rebuildTextOpenWorldGameplayRulesetFromAuthorEditableDraftV1,
  projectTextOpenWorldGameplayRulesetAuthorEditableDraftV1,
} from './gameplay-ruleset'
import {
  rebuildTextOpenWorldItemRewardCatalogFromAuthorEditableDraftV1,
  projectTextOpenWorldItemRewardCatalogAuthorEditableDraftV1,
} from './item-reward-catalog-production'
import {
  rebuildTextOpenWorldMainlineFromAuthorEditableDraftV1,
  projectTextOpenWorldMainlineAuthorEditableDraftV1,
} from './mainline-production'
import {
  rebuildTextOpenWorldMapInteractionCatalogFromAuthorEditableDraftV1,
  projectTextOpenWorldMapInteractionCatalogAuthorEditableDraftV1,
} from './map-interaction-catalog-production'
import {
  rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1,
  projectTextOpenWorldNpcRuntimeCatalogAuthorEditableDraftV1,
} from './npc-runtime-catalog-production'
import {
  rebuildTextOpenWorldPlayerBuildFromAuthorEditableDraftV1,
  projectTextOpenWorldPlayerBuildAuthorEditableDraftV1,
} from './player-build'
import {
  rebuildTextOpenWorldPresentationProfileFromAuthorEditableDraftV1,
  projectTextOpenWorldPresentationProfileAuthorEditableDraftV1,
} from './presentation-profile'
import {
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
} from './production-contract'
import {
  rebuildTextOpenWorldProgressionCatalogsFromAuthorEditableDraftV1,
  projectTextOpenWorldProgressionCatalogsAuthorEditableDraftV1,
} from './progression-catalogs-production'
import {
  rebuildTextOpenWorldQuestFinalizeFromAuthorEditableDraftV1,
  projectTextOpenWorldQuestFinalizeAuthorEditableDraftV1,
} from './quest-finalize-production'
import {
  rebuildTextOpenWorldQuestSkeletonsFromAuthorEditableDraftV1,
  projectTextOpenWorldQuestSkeletonsAuthorEditableDraftV1,
} from './quest-skeletons-production'
import {
  rebuildTextOpenWorldRegionNarrativePacksFromAuthorEditableDraftV1,
  projectTextOpenWorldRegionNarrativePacksAuthorEditableDraftV1,
} from './region-narrative-packs-production'
import {
  rebuildTextOpenWorldRegionSkeletonFromAuthorEditableDraftV1,
  projectTextOpenWorldRegionSkeletonAuthorEditableDraftV1,
} from './region-skeleton'
import {
  rebuildTextOpenWorldSceneScriptsFromAuthorEditableDraftV1,
  projectTextOpenWorldSceneScriptsAuthorEditableDraftV1,
} from './scene-scripts-production'
import {
  rebuildTextOpenWorldSignificantThreadsFromAuthorEditableDraftV1,
  projectTextOpenWorldSignificantThreadsAuthorEditableDraftV1,
} from './significant-threads-production'
import {
  rebuildTextOpenWorldStoryArchitectureFromAuthorEditableDraftV1,
  projectTextOpenWorldStoryArchitectureAuthorEditableDraftV1,
} from './story-architecture'
import {
  rebuildTextOpenWorldSystemFinalizeFromAuthorEditableDraftV1,
  projectTextOpenWorldSystemFinalizeAuthorEditableDraftV1,
} from './system-finalize-production'

const EDITABLE_ARTIFACT_KINDS = new Set<ProductBuildArtifactKindV1>(
  TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1,
)
const PROTECTED_FIELD = /^(?:schema|version|id|.*Ids?|key|.*Keys?|number|.*Numbers?|hash|.*Hashes?|owner|status|createdAt|updatedAt|producer.*|receipt.*|sourceClaims?|sourceEvidence)$/i
const REFERENCE_FIELD = /Key(?:s)?$/
const STABLE_STRUCTURE_FIELD = /^(?:schema|version|id|.*Ids?|key|number|.*Numbers?|order)$/i
const STATIC_PROTAGONIST_IDENTITY = 'character:text-open-world.protagonist-asset.root'
const STATIC_STORY_IDENTITY = 'story:text-open-world.story-arc.root'

export interface TextOpenWorldCreatorAuthorEditableArtifactV1 {
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  payload: unknown
}

export interface TextOpenWorldCreatorAuthorEditableArtifactInputV1 {
  artifactKey: string
  payload: unknown
}

export interface TextOpenWorldCreatorStableReferenceSlotV1 {
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  jsonPointer: string
  targetKey: string
}

export interface TextOpenWorldCreatorAuthorEditableProjectionV1 {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  outputArtifactKeys: TextOpenWorldCreatorEditableArtifactKindV1[]
  target: {
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
    entityIdentity: string | null
  }
  draft: unknown
  draftHash: string
  stableStructureHash: string
  identitySequence: string[]
  identitySequenceHash: string
  referenceSlots: TextOpenWorldCreatorStableReferenceSlotV1[]
  referenceHash: string
  editableFields: TextOpenWorldCreatorEditFieldV1[]
}

export interface TextOpenWorldCreatorAuthorEditableRebuildV1 {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  validatorId: string
  outputArtifactKeys: TextOpenWorldCreatorEditableArtifactKindV1[]
  requiredGateIds: string[]
  passedGateIds: string[]
  artifacts: TextOpenWorldCreatorAuthorEditableArtifactV1[]
  draftHash: string
  stableStructureHash: string
  identitySequence: string[]
  identitySequenceHash: string
  referenceSlots: TextOpenWorldCreatorStableReferenceSlotV1[]
  referenceHash: string
}

interface ResolvedTaskV1 {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  skillId: string
  outputArtifactKeys: TextOpenWorldCreatorEditableArtifactKindV1[]
  requiredGateIds: string[]
}

interface EntityCollectionSpecV1 {
  path: readonly string[]
  kind: string
  staticKey?: string
}

const ENTITY_COLLECTIONS: Readonly<Partial<Record<
  TextOpenWorldCreatorEditableArtifactKindV1,
  readonly EntityCollectionSpecV1[]
>>> = {
  'text-open-world.protagonist-asset': [
    { path: [], kind: 'character', staticKey: 'text-open-world.protagonist-asset.root' },
  ],
  'text-open-world.story-arc': [
    { path: [], kind: 'story', staticKey: 'text-open-world.story-arc.root' },
    { path: ['macroBeats'], kind: 'story-beat' },
  ],
  'text-open-world.ending-contracts': [{ path: ['endings'], kind: 'ending' }],
  'text-open-world.narrative-promises': [{ path: ['promises'], kind: 'promise' }],
  'text-open-world.mainline-thread': [
    { path: ['thread'], kind: 'storyline' },
    { path: ['stages'], kind: 'story-stage' },
  ],
  'text-open-world.significant-threads': [
    { path: ['threads'], kind: 'storyline' },
    { path: ['stages'], kind: 'story-stage' },
  ],
  'text-open-world.region-skeleton': [
    { path: ['regions'], kind: 'region' },
    { path: ['locations'], kind: 'location' },
    { path: ['edges'], kind: 'route' },
    { path: ['fastTravelPoints'], kind: 'fast-travel-point' },
  ],
  'text-open-world.region-narrative-packs': [
    { path: ['packs'], kind: 'story' },
    { path: ['packs', '*', 'ordinaryQuestSeeds'], kind: 'quest-seed' },
    { path: ['packs', '*', 'taskTemplateSeeds'], kind: 'quest-seed' },
    { path: ['packs', '*', 'randomEventSeeds'], kind: 'event' },
  ],
  'text-open-world.quest-skeletons': [
    { path: ['quests'], kind: 'quest' },
    { path: ['stages'], kind: 'quest-stage' },
    { path: ['objectives'], kind: 'quest-objective' },
  ],
  'text-open-world.content-requirement-manifest': [{ path: ['requirements'], kind: 'requirement' }],
  'text-open-world.progression-catalogs': [{ path: ['skills'], kind: 'skill' }],
  'text-open-world.enemy-encounter-catalog': [
    { path: ['enemies'], kind: 'enemy' },
    { path: ['encounters'], kind: 'encounter' },
  ],
  'text-open-world.item-reward-catalog': [
    { path: ['items'], kind: 'item' },
    { path: ['rewardContracts'], kind: 'reward' },
    { path: ['dropTables'], kind: 'drop-table' },
  ],
  'text-open-world.crafting-economy-catalog': [
    { path: ['recipes'], kind: 'recipe' },
    { path: ['vendors'], kind: 'vendor' },
  ],
  'text-open-world.npc-runtime-catalog': [
    { path: ['factions'], kind: 'faction' },
    { path: ['actors'], kind: 'character' },
    { path: ['schedules'], kind: 'schedule' },
  ],
  'text-open-world.map-interaction-catalog': [
    { path: ['regions'], kind: 'region' },
    { path: ['locations'], kind: 'location' },
    { path: ['interactions'], kind: 'interaction' },
  ],
  'text-open-world.quest-design-documents': [
    { path: ['quests'], kind: 'quest' },
    { path: ['stages'], kind: 'quest-stage' },
    { path: ['objectives'], kind: 'quest-objective' },
    { path: ['conditions'], kind: 'condition' },
    { path: ['effects'], kind: 'effect' },
    { path: ['actions'], kind: 'action' },
  ],
  'text-open-world.director-decks': [
    { path: ['templates'], kind: 'quest-seed' },
    { path: ['randomEvents'], kind: 'event' },
  ],
  'text-open-world.scene-scripts': [{ path: ['scenes'], kind: 'scene' }],
}

function fail(message: string): never {
  throw new Error(`[creator-artifact-edit-dispatch] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectAt(value: unknown, ...path: Array<string | number>): Record<string, unknown> | null {
  let current: unknown = value
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return null
      current = current[segment]
    } else {
      if (current == null || typeof current !== 'object' || Array.isArray(current)) return null
      current = (current as Record<string, unknown>)[segment]
    }
  }
  return current != null && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null
}

function keyOf(value: unknown): string | null {
  const key = value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).key
    : null
  return typeof key === 'string' && key.length > 0 ? key : null
}

function identity(kind: string, value: unknown): string | null {
  const key = keyOf(value)
  return key === null ? null : `${kind}:${key}`
}

function artifactPayload(
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[],
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1,
): Record<string, unknown> {
  const artifact = artifacts.find(candidate => candidate.artifactKey === artifactKey)
    ?? fail(`缺少 sibling Artifact:${artifactKey}`)
  return record(artifact.payload, artifactKey)
}

function isRepairTaskKey(value: string): value is TextOpenWorldAuthorRepairTaskKeyV1 {
  return Object.prototype.hasOwnProperty.call(TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1, value)
}

function resolveTask(taskKey: string): ResolvedTaskV1 {
  if (!isRepairTaskKey(taskKey)) fail(`任务不支持作者编辑:${taskKey}`)
  const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(candidate => candidate.taskKey === taskKey)
    ?? fail(`生产合同缺少任务:${taskKey}`)
  const skillId = TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1[taskKey]
  if (task.executionMode !== 'model' || task.skillId !== skillId || task.failurePolicy !== 'pause') {
    fail(`任务与作者修复 Skill 合同不一致:${taskKey}`)
  }
  if (task.outputArtifactKeys.length < 1
    || task.outputArtifactKeys.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumSiblingArtifacts
    || task.outputArtifactKeys.some(key => !EDITABLE_ARTIFACT_KINDS.has(key))) {
    fail(`任务输出不属于 Creator 可编辑闭集:${taskKey}`)
  }
  return {
    taskKey,
    skillId,
    outputArtifactKeys: [...task.outputArtifactKeys] as TextOpenWorldCreatorEditableArtifactKindV1[],
    requiredGateIds: [...task.completion.requiredGateIds],
  }
}

function exactSiblingGroup(
  task: ResolvedTaskV1,
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactInputV1[],
): TextOpenWorldCreatorAuthorEditableArtifactV1[] {
  if (artifacts.length !== task.outputArtifactKeys.length) {
    fail(`${task.taskKey} 必须完整提供 owner sibling group`)
  }
  const seen = new Set<string>()
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]
    if (seen.has(artifact.artifactKey)) fail(`sibling Artifact 重复:${artifact.artifactKey}`)
    seen.add(artifact.artifactKey)
    if (artifact.artifactKey !== task.outputArtifactKeys[index]) {
      fail(`${task.taskKey} sibling Artifact 必须按生产 Plan 顺序提供`)
    }
    record(artifact.payload, artifact.artifactKey)
  }
  return artifacts.map((artifact, index) => ({
    artifactKey: task.outputArtifactKeys[index],
    payload: structuredClone(artifact.payload),
  }))
}

function valuesAt(value: unknown, path: readonly string[]): unknown[] {
  if (path.length === 0) return [value]
  const [head, ...tail] = path
  if (head === '*') return Array.isArray(value) ? value.flatMap(entry => valuesAt(entry, tail)) : []
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return []
  const next = (value as Record<string, unknown>)[head]
  if (tail.length === 0 && Array.isArray(next)) return next
  return valuesAt(next, tail)
}

function collectIdentitySequence(
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[],
): string[] {
  const result: string[] = []
  for (const artifact of artifacts) {
    const specs = ENTITY_COLLECTIONS[artifact.artifactKey] ?? []
    for (const spec of specs) {
      const rows = valuesAt(artifact.payload, spec.path)
      for (const row of rows) {
        const key = spec.staticKey ?? keyOf(row) ?? fail(
          `${artifact.artifactKey} 实体集合 ${spec.path.join('.') || 'root'} 缺少稳定 key`,
        )
        result.push(`${spec.kind}:${key}`)
      }
    }
  }
  if (new Set(result).size !== result.length) fail('owner sibling group 内存在重复实体身份')
  return result
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function unescapePointerSegment(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}

function collectReferenceSlots(
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[],
): TextOpenWorldCreatorStableReferenceSlotV1[] {
  const result: TextOpenWorldCreatorStableReferenceSlotV1[] = []
  const walk = (
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1,
    value: unknown,
    segments: string[],
    propertyName: string | null,
  ): void => {
    if (typeof value === 'string') {
      if (propertyName !== 'key' && propertyName !== null && REFERENCE_FIELD.test(propertyName)) {
        result.push({ artifactKey, jsonPointer: `/${segments.map(escapePointerSegment).join('/')}`, targetKey: value })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(artifactKey, entry, [...segments, String(index)], propertyName))
      return
    }
    if (value == null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      walk(artifactKey, entry, [...segments, key], key)
    }
  }
  for (const artifact of artifacts) walk(artifact.artifactKey, artifact.payload, [], null)
  return result
}

function collectStableStructureSlots(
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[],
): Array<{
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  jsonPointer: string
  value: unknown
}> {
  const result: Array<{
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
    jsonPointer: string
    value: unknown
  }> = []
  const walk = (
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1,
    value: unknown,
    segments: string[],
    propertyName: string | null,
  ): void => {
    if (propertyName !== null && STABLE_STRUCTURE_FIELD.test(propertyName)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      result.push({
        artifactKey,
        jsonPointer: `/${segments.map(escapePointerSegment).join('/')}`,
        value,
      })
      return
    }
    if (Array.isArray(value)) {
      if (value.some(entry => entry != null && typeof entry === 'object')) {
        result.push({
          artifactKey,
          jsonPointer: `/${segments.map(escapePointerSegment).join('/')}/#length`,
          value: value.length,
        })
      }
      value.forEach((entry, index) => walk(artifactKey, entry, [...segments, String(index)], propertyName))
      return
    }
    if (value == null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      walk(artifactKey, entry, [...segments, key], key)
    }
  }
  for (const artifact of artifacts) walk(artifact.artifactKey, artifact.payload, [], null)
  return result
}

async function structuralEvidence(
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1,
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[],
): Promise<Pick<TextOpenWorldCreatorAuthorEditableProjectionV1,
  'stableStructureHash' | 'identitySequence' | 'identitySequenceHash' | 'referenceSlots' | 'referenceHash'>> {
  const identitySequence = collectIdentitySequence(artifacts)
  const referenceSlots = collectReferenceSlots(artifacts)
  const stableStructureSlots = collectStableStructureSlots(artifacts)
  const identitySequenceHash = await hashProductProductionValueV2(identitySequence)
  const referenceHash = await hashProductProductionValueV2(referenceSlots)
  return {
    identitySequence,
    identitySequenceHash,
    referenceSlots,
    referenceHash,
    stableStructureHash: await hashProductProductionValueV2({
      taskKey,
      artifactKeySequence: artifacts.map(artifact => artifact.artifactKey),
      identitySequence,
      referenceSlots,
      stableStructureSlots,
    }),
  }
}

function entityFromFlatCollection(input: {
  artifact: Record<string, unknown>
  collection: string
  index: number
  kind: string
}): string | null {
  return identity(input.kind, array(input.artifact[input.collection])[input.index])
}

function resolveRegionEntity(
  segments: string[],
  artifact: Record<string, unknown>,
): string | null {
  const regionIndex = Number(segments[1])
  if (segments[0] === 'connections') {
    return entityFromFlatCollection({ artifact, collection: 'edges', index: regionIndex, kind: 'route' })
  }
  if (segments[0] !== 'regions' || !Number.isSafeInteger(regionIndex)) return null
  const region = array(artifact.regions)[regionIndex]
  if (segments[2] !== 'locations') return identity('region', region)
  const regionKey = keyOf(region)
  const locationIndex = Number(segments[3])
  const locations = array(artifact.locations).filter(candidate => {
    const row = candidate != null && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown> : null
    return row?.regionKey === regionKey
  })
  return identity('location', locations[locationIndex])
}

function resolveSignificantThreadEntity(
  segments: string[],
  artifact: Record<string, unknown>,
): string | null {
  if (segments[0] !== 'threads') return null
  const thread = array(artifact.threads)[Number(segments[1])]
  if (segments[2] !== 'stages') return identity('storyline', thread)
  const threadKey = keyOf(thread)
  const stages = array(artifact.stages).filter(candidate => objectAt(candidate)?.threadKey === threadKey)
    .sort((left, right) => Number(objectAt(left)?.order ?? 0) - Number(objectAt(right)?.order ?? 0))
  return identity('story-stage', stages[Number(segments[3])])
}

function resolveRegionPackEntity(
  segments: string[],
  artifact: Record<string, unknown>,
): string | null {
  if (segments[0] !== 'packs') return null
  const pack = array(artifact.packs)[Number(segments[1])]
  const nested = segments[2]
  if (nested === 'ordinaryQuestSeeds' || nested === 'taskTemplateSeeds') {
    return identity('quest-seed', array(objectAt(pack)?.[nested])[Number(segments[3])])
  }
  if (nested === 'randomEventSeeds') {
    return identity('event', array(objectAt(pack)?.[nested])[Number(segments[3])])
  }
  return identity('story', pack)
}

function resolveQuestSkeletonEntity(
  segments: string[],
  questArtifact: Record<string, unknown>,
  requirementArtifact: Record<string, unknown>,
): string | null {
  if (segments[0] !== 'quests') return null
  const quest = array(questArtifact.quests)[Number(segments[1])]
  if (segments[2] !== 'stages') return identity('quest', quest)
  const stages = array(questArtifact.stages)
    .filter(candidate => objectAt(candidate)?.questKey === keyOf(quest))
    .sort((left, right) => Number(objectAt(left)?.order ?? 0) - Number(objectAt(right)?.order ?? 0))
  const stage = stages[Number(segments[3])]
  if (segments[4] !== 'objectives') return identity('quest-stage', stage)
  const objectives = array(questArtifact.objectives)
    .filter(candidate => objectAt(candidate)?.stageKey === keyOf(stage))
    .sort((left, right) => Number(objectAt(left)?.order ?? 0) - Number(objectAt(right)?.order ?? 0))
  const objective = objectives[Number(segments[5])]
  if (segments[6] !== 'requirements') return identity('quest-objective', objective)
  const requirementKeys = array(objectAt(objective)?.requirementKeys)
  const requirementKey = requirementKeys[Number(segments[7])]
  return identity('requirement', array(requirementArtifact.requirements)
    .find(candidate => keyOf(candidate) === requirementKey))
}

function resolveNpcEntity(segments: string[], artifact: Record<string, unknown>): string | null {
  if (segments[0] === 'factions') {
    return entityFromFlatCollection({ artifact, collection: 'factions', index: Number(segments[1]), kind: 'faction' })
  }
  if (segments[0] !== 'actors') return null
  const actor = array(artifact.actors).filter(candidate => objectAt(candidate)?.demandKind !== 'service-replacement')[Number(segments[1])]
  if (segments[2] !== 'scheduleActivities') return identity('character', actor)
  const schedule = array(artifact.schedules).find(candidate => objectAt(candidate)?.actorKey === keyOf(actor))
  return identity('schedule', schedule)
}

function resolveEncounterEntity(segments: string[], artifact: Record<string, unknown>): string | null {
  if (segments[0] !== 'encounters') return null
  const index = Number(segments[1])
  const leaf = segments[segments.length - 1] ?? ''
  if (['enemyTitle', 'enemyDescription', 'enemyTags', 'enemyArchetype'].includes(leaf)) {
    return entityFromFlatCollection({ artifact, collection: 'enemies', index, kind: 'enemy' })
  }
  return entityFromFlatCollection({ artifact, collection: 'encounters', index, kind: 'encounter' })
}

function resolveEntityIdentity(input: {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  segments: string[]
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[]
}): string | null {
  const { taskKey, artifactKey, segments, artifacts } = input
  if (taskKey === 'p2.experience-design') {
    return artifactKey === 'text-open-world.protagonist-asset' ? STATIC_PROTAGONIST_IDENTITY : null
  }
  if (taskKey === 'p3.story-architecture') {
    if (segments[0] === 'macroBeats') return entityFromFlatCollection({
      artifact: artifactPayload(artifacts, 'text-open-world.story-arc'), collection: 'macroBeats',
      index: Number(segments[1]), kind: 'story-beat',
    })
    if (segments[0] === 'endings') return entityFromFlatCollection({
      artifact: artifactPayload(artifacts, 'text-open-world.ending-contracts'), collection: 'endings',
      index: Number(segments[1]), kind: 'ending',
    })
    if (segments[0] === 'promises') return entityFromFlatCollection({
      artifact: artifactPayload(artifacts, 'text-open-world.narrative-promises'), collection: 'promises',
      index: Number(segments[1]), kind: 'promise',
    })
    return artifactKey === 'text-open-world.story-arc' ? STATIC_STORY_IDENTITY : null
  }
  if (taskKey === 'p4.region-skeleton') {
    return resolveRegionEntity(segments, artifactPayload(artifacts, 'text-open-world.region-skeleton'))
  }
  if (taskKey === 'p5.mainline') {
    const artifact = artifactPayload(artifacts, 'text-open-world.mainline-thread')
    return segments[0] === 'stages'
      ? entityFromFlatCollection({ artifact, collection: 'stages', index: Number(segments[1]), kind: 'story-stage' })
      : identity('storyline', artifact.thread)
  }
  if (taskKey === 'p6.significant-threads') {
    return resolveSignificantThreadEntity(segments, artifactPayload(artifacts, 'text-open-world.significant-threads'))
  }
  if (taskKey === 'p7.region-narrative-packs') {
    return resolveRegionPackEntity(segments, artifactPayload(artifacts, 'text-open-world.region-narrative-packs'))
  }
  if (taskKey === 'p8.quest-skeletons') {
    return resolveQuestSkeletonEntity(
      segments,
      artifactPayload(artifacts, 'text-open-world.quest-skeletons'),
      artifactPayload(artifacts, 'text-open-world.content-requirement-manifest'),
    )
  }
  if (taskKey === 'p8.catalog.progression' && segments[0] === 'skills') {
    return entityFromFlatCollection({ artifact: artifactPayload(artifacts, artifactKey), collection: 'skills', index: Number(segments[1]), kind: 'skill' })
  }
  if (taskKey === 'p8.catalog.encounters') {
    return resolveEncounterEntity(segments, artifactPayload(artifacts, artifactKey))
  }
  if (taskKey === 'p8.catalog.items-rewards') {
    const artifact = artifactPayload(artifacts, artifactKey)
    if (segments[0] === 'items') return entityFromFlatCollection({ artifact, collection: 'items', index: Number(segments[1]), kind: 'item' })
    if (segments[0] === 'rewards') return entityFromFlatCollection({ artifact, collection: 'rewardContracts', index: Number(segments[1]), kind: 'reward' })
  }
  if (taskKey === 'p8.catalog.crafting-economy') {
    const collection = segments[0]
    if (collection === 'recipes' || collection === 'vendors') return entityFromFlatCollection({
      artifact: artifactPayload(artifacts, artifactKey), collection, index: Number(segments[1]),
      kind: collection === 'recipes' ? 'recipe' : 'vendor',
    })
  }
  if (taskKey === 'p8.catalog.npc-runtime') return resolveNpcEntity(segments, artifactPayload(artifacts, artifactKey))
  if (taskKey === 'p8.catalog.map-interactions' && segments[0] === 'interactions') {
    return entityFromFlatCollection({ artifact: artifactPayload(artifacts, artifactKey), collection: 'interactions', index: Number(segments[1]), kind: 'interaction' })
  }
  if (taskKey === 'p8f.quest-finalize') {
    const quest = artifactPayload(artifacts, 'text-open-world.quest-design-documents')
    const director = artifactPayload(artifacts, 'text-open-world.director-decks')
    if (segments[0] === 'quests') return entityFromFlatCollection({ artifact: quest, collection: 'quests', index: Number(segments[1]), kind: 'quest' })
    if (segments[0] === 'objectives') return entityFromFlatCollection({ artifact: quest, collection: 'objectives', index: Number(segments[1]), kind: 'quest-objective' })
    if (segments[0] === 'templates') return entityFromFlatCollection({ artifact: director, collection: 'templates', index: Number(segments[1]), kind: 'quest-seed' })
    if (segments[0] === 'randomEvents') return entityFromFlatCollection({ artifact: director, collection: 'randomEvents', index: Number(segments[1]), kind: 'event' })
  }
  if (taskKey === 'p9.scene-scripts' && artifactKey === 'text-open-world.scene-scripts' && segments[0] === 'scenes') {
    return entityFromFlatCollection({ artifact: artifactPayload(artifacts, artifactKey), collection: 'scenes', index: Number(segments[1]), kind: 'scene' })
  }
  return null
}

function artifactKeyForDraftPath(
  task: ResolvedTaskV1,
  segments: readonly string[],
): TextOpenWorldCreatorEditableArtifactKindV1 {
  if (task.taskKey === 'p2.experience-design') {
    return segments[0] === 'protagonist'
      ? 'text-open-world.protagonist-asset' : 'text-open-world.experience-contract'
  }
  if (task.taskKey === 'p3.story-architecture') {
    if (segments[0] === 'endings') return 'text-open-world.ending-contracts'
    if (segments[0] === 'promises') return 'text-open-world.narrative-promises'
    return 'text-open-world.story-arc'
  }
  if (task.taskKey === 'p8.quest-skeletons') {
    return segments.includes('requirements')
      ? 'text-open-world.content-requirement-manifest' : 'text-open-world.quest-skeletons'
  }
  if (task.taskKey === 'p8f.quest-finalize') {
    return ['decks', 'templates', 'randomEvents'].includes(segments[0] ?? '')
      ? 'text-open-world.director-decks' : 'text-open-world.quest-design-documents'
  }
  if (task.taskKey === 'p9.scene-scripts') {
    if (segments[0] === 'actionUtterances') return 'text-open-world.action-bindings'
    if (segments[0] === 'scenes' && segments[segments.length - 1] === 'choiceLabels') {
      return 'text-open-world.choice-contracts'
    }
    return 'text-open-world.scene-scripts'
  }
  if (task.taskKey === 'p10.system-finalize') return 'text-open-world.media-requirements'
  return task.outputArtifactKeys[0]
}

function valueKind(value: unknown): TextOpenWorldCreatorEditValueKindV1 | null {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) return 'string-array'
  return null
}

function fieldLabel(segments: readonly string[]): string {
  return segments.map(segment => /^\d+$/.test(segment) ? `[${Number(segment) + 1}]` : segment)
    .join('.').replace(/\.\[/g, '[').slice(0, 500)
}

async function enumerateEditableFields(input: {
  task: ResolvedTaskV1
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[]
  draft: unknown
  target: {
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
    entityIdentity: string | null
  }
}): Promise<TextOpenWorldCreatorEditFieldV1[]> {
  const pending: Array<{ value: unknown; segments: string[] }> = [{ value: input.draft, segments: [] }]
  const candidates: Array<{
    artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
    entityIdentity: string | null
    jsonPointer: string
    label: string
    valueKind: TextOpenWorldCreatorEditValueKindV1
    value: unknown
  }> = []
  while (pending.length > 0) {
    const current = pending.pop()!
    const kind = valueKind(current.value)
    const leaf = current.segments[current.segments.length - 1] ?? ''
    if (kind !== null) {
      if (current.segments.length === 0 || /^\d+$/.test(leaf) || PROTECTED_FIELD.test(leaf)) continue
      const artifactKey = artifactKeyForDraftPath(input.task, current.segments)
      const entityIdentity = resolveEntityIdentity({
        taskKey: input.task.taskKey,
        artifactKey,
        segments: current.segments,
        artifacts: input.artifacts,
      })
      if (artifactKey !== input.target.artifactKey || entityIdentity !== input.target.entityIdentity) continue
      candidates.push({
        artifactKey,
        entityIdentity,
        jsonPointer: `/${current.segments.map(escapePointerSegment).join('/')}`,
        label: fieldLabel(current.segments),
        valueKind: kind,
        value: current.value,
      })
      continue
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], segments: [...current.segments, String(index)] })
      }
      continue
    }
    if (current.value == null || typeof current.value !== 'object') continue
    const entries = Object.entries(current.value as Record<string, unknown>)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index]
      pending.push({ value, segments: [...current.segments, key] })
    }
  }
  if (candidates.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumEditableFields) {
    fail(`目标可编辑字段超过 ${TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumEditableFields} 安全上限`)
  }
  const fields = await Promise.all(candidates.map(async candidate => parseTextOpenWorldCreatorEditFieldV1({
    schema: 'storyforge.text-open-world-creator-edit-field',
    version: 1,
    fieldId: `field.${await hashProductProductionValueV2({
      taskKey: input.task.taskKey,
      artifactKey: candidate.artifactKey,
      entityIdentity: candidate.entityIdentity,
      jsonPointer: candidate.jsonPointer,
    })}`,
    artifactKey: candidate.artifactKey,
    entityIdentity: candidate.entityIdentity,
    jsonPointer: candidate.jsonPointer,
    label: candidate.label,
    valueKind: candidate.valueKind,
    baseValueHash: await hashProductProductionValueV2(candidate.value),
    maximumUtf8Bytes: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumValueUtf8Bytes,
    mutationPolicy: 'replace-only',
    stableIdPolicy: 'preserve',
    entitySetPolicy: 'preserve',
    entityOrderPolicy: 'preserve',
  })))
  return fields.sort((left, right) => left.jsonPointer.localeCompare(right.jsonPointer))
}

async function projectDomainDraft(input: {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[]
  context: string
}): Promise<unknown> {
  const artifact = input.artifacts[0]?.payload as never
  if (input.taskKey === 'p2.experience-design') return projectTextOpenWorldExperienceAuthorEditableDraftV1({
    artifacts: {
      gameBrief: input.artifacts[0].payload as never,
      experienceContract: input.artifacts[1].payload as never,
      protagonistAsset: input.artifacts[2].payload as never,
    }, context: input.context,
  })
  if (input.taskKey === 'p2.gameplay-ruleset') return projectTextOpenWorldGameplayRulesetAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p2.presentation-profile') return projectTextOpenWorldPresentationProfileAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p3.story-architecture') return projectTextOpenWorldStoryArchitectureAuthorEditableDraftV1({
    artifacts: {
      storyArc: input.artifacts[0].payload as never,
      endingContracts: input.artifacts[1].payload as never,
      narrativePromises: input.artifacts[2].payload as never,
    }, context: input.context,
  })
  if (input.taskKey === 'p4.region-skeleton') return projectTextOpenWorldRegionSkeletonAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p4.player-build') return projectTextOpenWorldPlayerBuildAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p5.mainline') return projectTextOpenWorldMainlineAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p6.significant-threads') return projectTextOpenWorldSignificantThreadsAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p7.region-narrative-packs') return projectTextOpenWorldRegionNarrativePacksAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.quest-skeletons') return projectTextOpenWorldQuestSkeletonsAuthorEditableDraftV1({
    artifacts: {
      questSkeletons: input.artifacts[0].payload as never,
      contentRequirementManifest: input.artifacts[1].payload as never,
    }, context: input.context,
  })
  if (input.taskKey === 'p8.catalog.progression') return projectTextOpenWorldProgressionCatalogsAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.catalog.encounters') return projectTextOpenWorldEncounterCatalogAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.catalog.items-rewards') return projectTextOpenWorldItemRewardCatalogAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.catalog.crafting-economy') return projectTextOpenWorldCraftingEconomyCatalogAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.catalog.npc-runtime') return projectTextOpenWorldNpcRuntimeCatalogAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8.catalog.map-interactions') return projectTextOpenWorldMapInteractionCatalogAuthorEditableDraftV1({ artifact, context: input.context })
  if (input.taskKey === 'p8f.quest-finalize') return projectTextOpenWorldQuestFinalizeAuthorEditableDraftV1({
    artifacts: {
      questDesignDocuments: input.artifacts[0].payload as never,
      directorDecks: input.artifacts[1].payload as never,
    }, context: input.context,
  })
  if (input.taskKey === 'p9.scene-scripts') return projectTextOpenWorldSceneScriptsAuthorEditableDraftV1({
    artifacts: {
      sceneScripts: input.artifacts[0].payload as never,
      choiceContracts: input.artifacts[1].payload as never,
      actionBindings: input.artifacts[2].payload as never,
    }, context: input.context,
  })
  if (input.taskKey === 'p10.system-finalize') return projectTextOpenWorldSystemFinalizeAuthorEditableDraftV1({
    artifacts: {
      systemConfigs: input.artifacts[0].payload as never,
      mediaRequirements: input.artifacts[1].payload as never,
      contentBudget: input.artifacts[2].payload as never,
    }, context: input.context,
  })
  return fail(`没有 project dispatcher:${input.taskKey}`)
}

async function rebuildDomainArtifacts(input: {
  taskKey: TextOpenWorldAuthorRepairTaskKeyV1
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactV1[]
  context: string
  draft: unknown
}): Promise<unknown[]> {
  const baseArtifact = input.artifacts[0]?.payload as never
  if (input.taskKey === 'p2.experience-design') {
    const result = await rebuildTextOpenWorldExperienceFromAuthorEditableDraftV1({
      baseArtifacts: {
        gameBrief: input.artifacts[0].payload as never,
        experienceContract: input.artifacts[1].payload as never,
        protagonistAsset: input.artifacts[2].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.gameBrief, result.experienceContract, result.protagonistAsset]
  }
  if (input.taskKey === 'p2.gameplay-ruleset') return [await rebuildTextOpenWorldGameplayRulesetFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p2.presentation-profile') return [await rebuildTextOpenWorldPresentationProfileFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p3.story-architecture') {
    const result = await rebuildTextOpenWorldStoryArchitectureFromAuthorEditableDraftV1({
      baseArtifacts: {
        storyArc: input.artifacts[0].payload as never,
        endingContracts: input.artifacts[1].payload as never,
        narrativePromises: input.artifacts[2].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.storyArc, result.endingContracts, result.narrativePromises]
  }
  if (input.taskKey === 'p4.region-skeleton') return [await rebuildTextOpenWorldRegionSkeletonFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p4.player-build') return [await rebuildTextOpenWorldPlayerBuildFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p5.mainline') return [await rebuildTextOpenWorldMainlineFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p6.significant-threads') return [await rebuildTextOpenWorldSignificantThreadsFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p7.region-narrative-packs') return [await rebuildTextOpenWorldRegionNarrativePacksFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.quest-skeletons') {
    const result = await rebuildTextOpenWorldQuestSkeletonsFromAuthorEditableDraftV1({
      baseArtifacts: {
        questSkeletons: input.artifacts[0].payload as never,
        contentRequirementManifest: input.artifacts[1].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.questSkeletons, result.contentRequirementManifest]
  }
  if (input.taskKey === 'p8.catalog.progression') return [await rebuildTextOpenWorldProgressionCatalogsFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.catalog.encounters') return [await rebuildTextOpenWorldEncounterCatalogFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.catalog.items-rewards') return [await rebuildTextOpenWorldItemRewardCatalogFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.catalog.crafting-economy') return [await rebuildTextOpenWorldCraftingEconomyCatalogFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.catalog.npc-runtime') return [await rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8.catalog.map-interactions') return [await rebuildTextOpenWorldMapInteractionCatalogFromAuthorEditableDraftV1({ baseArtifact, context: input.context, draft: input.draft })]
  if (input.taskKey === 'p8f.quest-finalize') {
    const result = await rebuildTextOpenWorldQuestFinalizeFromAuthorEditableDraftV1({
      baseArtifacts: {
        questDesignDocuments: input.artifacts[0].payload as never,
        directorDecks: input.artifacts[1].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.questDesignDocuments, result.directorDecks]
  }
  if (input.taskKey === 'p9.scene-scripts') {
    const result = await rebuildTextOpenWorldSceneScriptsFromAuthorEditableDraftV1({
      baseArtifacts: {
        sceneScripts: input.artifacts[0].payload as never,
        choiceContracts: input.artifacts[1].payload as never,
        actionBindings: input.artifacts[2].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.sceneScripts, result.choiceContracts, result.actionBindings]
  }
  if (input.taskKey === 'p10.system-finalize') {
    const result = await rebuildTextOpenWorldSystemFinalizeFromAuthorEditableDraftV1({
      baseArtifacts: {
        systemConfigs: input.artifacts[0].payload as never,
        mediaRequirements: input.artifacts[1].payload as never,
        contentBudget: input.artifacts[2].payload as never,
      }, context: input.context, draft: input.draft,
    })
    return [result.systemConfigs, result.mediaRequirements, result.contentBudget]
  }
  return fail(`没有 rebuild dispatcher:${input.taskKey}`)
}

export async function projectTextOpenWorldCreatorAuthorEditableDraftV1(input: {
  taskKey: string
  artifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactInputV1[]
  context: string
  target: {
    artifactKey: string
    entityIdentity: string | null
  }
}): Promise<TextOpenWorldCreatorAuthorEditableProjectionV1> {
  const task = resolveTask(input.taskKey)
  const artifacts = exactSiblingGroup(task, input.artifacts)
  if (!task.outputArtifactKeys.includes(input.target.artifactKey as TextOpenWorldCreatorEditableArtifactKindV1)) {
    fail(`目标 Artifact 不属于 owner sibling group:${input.target.artifactKey}`)
  }
  if (input.target.entityIdentity !== null
    && (typeof input.target.entityIdentity !== 'string' || input.target.entityIdentity.length === 0)) {
    fail('目标 entityIdentity 无效')
  }
  const target = {
    artifactKey: input.target.artifactKey as TextOpenWorldCreatorEditableArtifactKindV1,
    entityIdentity: input.target.entityIdentity,
  }
  const draft = await projectDomainDraft({ taskKey: task.taskKey, artifacts, context: input.context })
  const draftHash = await hashProductProductionValueV2(draft)
  const structural = await structuralEvidence(task.taskKey, artifacts)
  return {
    taskKey: task.taskKey,
    outputArtifactKeys: task.outputArtifactKeys,
    target,
    draft: structuredClone(draft),
    draftHash,
    ...structural,
    editableFields: await enumerateEditableFields({ task, artifacts, draft, target }),
  }
}

function parsePointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) fail(`JSON Pointer 无效:${pointer}`)
  return pointer.slice(1).split('/').map(unescapePointerSegment)
}

function readPointer(root: unknown, pointer: string): unknown {
  let current = root
  for (const segment of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) fail(`JSON Pointer 越界:${pointer}`)
      current = current[index]
      continue
    }
    if (current == null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)) fail(`JSON Pointer 不存在:${pointer}`)
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function replacePointer(root: unknown, pointer: string, value: unknown): void {
  const segments = parsePointer(pointer)
  const leaf = segments.pop() ?? fail(`JSON Pointer 不能为空:${pointer}`)
  let parent = root
  for (const segment of segments) {
    if (Array.isArray(parent)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0 || index >= parent.length) fail(`JSON Pointer 越界:${pointer}`)
      parent = parent[index]
      continue
    }
    if (parent == null || typeof parent !== 'object'
      || !Object.prototype.hasOwnProperty.call(parent, segment)) fail(`JSON Pointer 不存在:${pointer}`)
    parent = (parent as Record<string, unknown>)[segment]
  }
  if (parent == null || typeof parent !== 'object') fail(`JSON Pointer 父节点无效:${pointer}`)
  if (Array.isArray(parent)) fail(`JSON Pointer 不允许直接替换集合成员:${pointer}`)
  if (!Object.prototype.hasOwnProperty.call(parent, leaf)) fail(`JSON Pointer 不存在:${pointer}`)
  ;(parent as Record<string, unknown>)[leaf] = structuredClone(value)
}

function normalizedEditValue(value: unknown, field: TextOpenWorldCreatorEditFieldV1): unknown {
  let normalized: unknown
  if (field.valueKind === 'string') {
    if (typeof value !== 'string') fail(`${field.fieldId} 必须是字符串`)
    normalized = value.normalize('NFC')
  } else if (field.valueKind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field.fieldId} 必须是有限数值`)
    normalized = Object.is(value, -0) ? 0 : value
  } else if (field.valueKind === 'boolean') {
    if (typeof value !== 'boolean') fail(`${field.fieldId} 必须是 boolean`)
    normalized = value
  } else {
    if (!Array.isArray(value) || value.length > 256 || value.some(entry => typeof entry !== 'string')) {
      fail(`${field.fieldId} 必须是最多 256 项的字符串数组`)
    }
    normalized = value.map(entry => (entry as string).normalize('NFC'))
  }
  const bytes = new TextEncoder().encode(canonicalProductProductionJsonV2(normalized)).byteLength
  if (bytes > field.maximumUtf8Bytes) fail(`${field.fieldId} 超过字段字节上限`)
  return normalized
}

export async function applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1(input: {
  draft: unknown
  draftHash: string
  editableFields: readonly TextOpenWorldCreatorEditFieldV1[]
  patch: TextOpenWorldCreatorEditPatchV1 | unknown
}): Promise<{ draft: unknown; draftHash: string }> {
  if (await hashProductProductionValueV2(input.draft) !== input.draftHash) fail('调用方 draftHash 与 full draft 不一致')
  if (input.editableFields.length < 1
    || input.editableFields.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumEditableFields) {
    fail('editableFields 必须是非空有界 target allowlist')
  }
  const patch = await parseTextOpenWorldCreatorEditPatchV1(input.patch)
  if (patch.baseDraftHash !== input.draftHash) fail('patch.baseDraftHash 与当前 full draft 不一致')
  const fieldById = new Map(input.editableFields.map(field => [field.fieldId, parseTextOpenWorldCreatorEditFieldV1(field)]))
  const parsedFields = [...fieldById.values()]
  const target = parsedFields[0]
  if (fieldById.size !== input.editableFields.length
    || new Set(parsedFields.map(field => field.jsonPointer)).size !== parsedFields.length) {
    fail('editableFields fieldId/jsonPointer 不允许重复')
  }
  if (parsedFields.some(field => field.artifactKey !== target.artifactKey
    || field.entityIdentity !== target.entityIdentity)) {
    fail('editableFields 必须属于一个精确 target')
  }
  const draft = structuredClone(input.draft)
  for (const operation of patch.operations) {
    const field = fieldById.get(operation.fieldId) ?? fail(`patch field 不在 allowlist:${operation.fieldId}`)
    if (operation.baseValueHash !== field.baseValueHash) fail(`patch baseValueHash 不一致:${field.fieldId}`)
    const current = readPointer(draft, field.jsonPointer)
    if (await hashProductProductionValueV2(current) !== field.baseValueHash) fail(`字段基值已变化:${field.fieldId}`)
    operation.value = normalizedEditValue(operation.value, field)
    replacePointer(draft, field.jsonPointer, operation.value)
  }
  if (await hashTextOpenWorldCreatorEditPatchV1(patch) !== patch.patchHash) {
    fail('字段值规范化后 patchHash 不一致')
  }
  return { draft, draftHash: await hashProductProductionValueV2(draft) }
}

export async function rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(input: {
  taskKey: string
  baseArtifacts: readonly TextOpenWorldCreatorAuthorEditableArtifactInputV1[]
  context: string
  draft: unknown
}): Promise<TextOpenWorldCreatorAuthorEditableRebuildV1> {
  const task = resolveTask(input.taskKey)
  const baseArtifacts = exactSiblingGroup(task, input.baseArtifacts)
  const before = await structuralEvidence(task.taskKey, baseArtifacts)
  const rebuiltPayloads = await rebuildDomainArtifacts({
    taskKey: task.taskKey,
    artifacts: baseArtifacts,
    context: input.context,
    draft: input.draft,
  })
  if (rebuiltPayloads.length !== task.outputArtifactKeys.length) fail(`${task.taskKey} rebuild 没有返回完整 sibling group`)
  const artifacts = task.outputArtifactKeys.map((artifactKey, index) => ({
    artifactKey,
    payload: structuredClone(rebuiltPayloads[index]),
  }))
  const after = await structuralEvidence(task.taskKey, artifacts)
  if (before.identitySequenceHash !== after.identitySequenceHash) {
    fail(`${task.taskKey} 编辑改变了稳定 ID、实体集合或实体顺序`)
  }
  if (before.referenceHash !== after.referenceHash) fail(`${task.taskKey} 编辑改变了稳定引用`)
  if (before.stableStructureHash !== after.stableStructureHash) fail(`${task.taskKey} 编辑改变了 owner sibling 结构`)
  return {
    taskKey: task.taskKey,
    validatorId: `text-open-world.${task.taskKey}.production-contract.v1`,
    outputArtifactKeys: task.outputArtifactKeys,
    requiredGateIds: task.requiredGateIds,
    passedGateIds: [...task.requiredGateIds],
    artifacts,
    draftHash: await hashProductProductionValueV2(input.draft),
    ...after,
  }
}
