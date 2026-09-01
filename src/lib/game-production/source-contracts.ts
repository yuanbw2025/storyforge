import { getAgentSkillV1 } from '../agent/skill-registry'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import type {
  ConfirmedProductBriefV1,
  GameProductionBriefRecordV1,
  GameProductionBriefV3,
  GameProductionPlanTaskV3,
  GameProductType,
  ProductSourcePlanV1,
  WorkspaceScope,
} from '../types'
import {
  createConfirmedProductBriefV1,
  freezeProductSourcePlanV1,
  resolveProductSourceReadBoundaryV1,
  validateConfirmedProductBriefV1,
  validateProductSourcePlanV1,
} from '../world-engine/product-source-contracts'
import {
  getGameProductWorldRequirementAdapterV1,
  type GameProductWorldRequirementGoalV1,
} from '../world-engine/product-requirement-adapters'
import { createWorldReferenceV1 } from '../world-engine/world-reference'
import { resolveGameProductionWorldCompilationDescriptorsV2 } from './world-source'

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[]
}

function selectedDescriptors(input: {
  brief: GameProductionBriefV3
  descriptors: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources']
}) {
  const selected = new Set(input.brief.source.selection.resourceKeys)
  const rows = input.descriptors.filter(descriptor => selected.has(descriptor.resourceKey))
  if (rows.length !== selected.size) {
    throw new Error('[game-production-source] Brief 选择包含不属于冻结 WorldRelease 的资源')
  }
  return rows
}

function requirementGoal(input: {
  brief: GameProductionBriefV3
  descriptors: ReturnType<typeof selectedDescriptors>
}): GameProductWorldRequirementGoalV1 {
  const participantKeys = input.brief.source.selection.roleBindings.participants
    ?? input.brief.source.selection.roleBindings.characters
    ?? []
  const selectedKinds = new Set(input.descriptors.map(item => item.worldSemantic!.resourceKind))
  const selectedAreas = unique(input.descriptors.map(item => item.worldSemantic!.area))
  return {
    selectedAreas,
    selectedResourceKinds: unique([...selectedKinds]),
    selectedContextKinds: unique(input.descriptors.map(item => item.kind)),
    selectedResourceCount: input.descriptors.length,
    participantCount: unique(participantKeys).length,
    includeSelectedRelations: input.descriptors.filter(item => (
      item.worldSemantic!.resourceKind === 'character'
    )).length > 1,
    inheritStoryContinuity: [...selectedKinds].some(kind => [
      'story-core', 'story-arc', 'storyline-progress', 'outline-node',
      'detailed-outline', 'chapter', 'foreshadow',
    ].includes(kind)),
    allowCrossWorld: selectedAreas.includes('multi-world'),
  }
}

export async function createGameProductionSourcePlanV1(input: {
  scope: WorkspaceScope
  productionKey: string
  brief: GameProductionBriefV3
  createdAt?: number
}): Promise<ProductSourcePlanV1> {
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.brief.source.worldReleaseId,
    expectedProjectId: input.scope.projectId,
    expectedWorldId: input.scope.worldId,
  })
  if (catalog.description.identity.releaseHash !== input.brief.source.worldContentHash) {
    throw new Error('[game-production-source] Brief 的 WorldRelease hash 已过期')
  }
  const descriptors = selectedDescriptors({ brief: input.brief, descriptors: catalog.resources })
  if (!descriptors.length) {
    throw new Error('[game-production-source] 正式产品至少需要一个作者冻结的世界资源')
  }
  const adapter = getGameProductWorldRequirementAdapterV1(input.brief.intent.productType)
  const roleAnchors = Object.values(input.brief.source.selection.roleBindings)
    .flatMap(keys => keys.slice(0, 3))
  const initialResourceKeys = unique([
    ...input.brief.source.startingPoint.sourceRefs,
    ...input.brief.source.startingPoint.protagonistRefs,
    ...input.brief.intent.protagonistRefs,
    ...roleAnchors,
  ]).filter(key => input.brief.source.selection.resourceKeys.includes(key))
  if (!initialResourceKeys.length) initialResourceKeys.push(input.brief.source.selection.resourceKeys[0]!)
  return freezeProductSourcePlanV1({
    productInstanceKey: input.productionKey,
    worldReference: await createWorldReferenceV1(input.brief.source.worldReleaseId),
    adapter,
    goal: requirementGoal({ brief: input.brief, descriptors }),
    missingStrategy: 'block',
    initialResourceKeys,
    allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
    maxReadCalls: Math.min(20_000, Math.max(200, descriptors.length + 50)),
    maxRetrievedTokens: Math.min(100_000, Math.max(1, input.brief.productionBudget.maximumInputTokens)),
    createdAt: input.createdAt,
  })
}

export function gameProductionTaskUsesWorldGatewayV1(task: GameProductionPlanTaskV3): boolean {
  const isDeterministicIntegration = task.executionMode === 'deterministic'
    && task.kind === 'runtime-package'
  const skill = getAgentSkillV1(task.skillId ?? 'game-production.integrate.v1')
  return skill.contextGateway?.providerSourceKeys.includes('worldRelease') === true
    && (task.executionMode === 'model' || task.skillId === 'game-production.integrate.v1'
      || isDeterministicIntegration)
}

export async function parseGameProductionSourcePlanV1(
  row: Pick<GameProductionBriefRecordV1, 'sourcePlanJson' | 'sourcePlanHash'>,
): Promise<ProductSourcePlanV1> {
  let value: ProductSourcePlanV1
  try { value = JSON.parse(row.sourcePlanJson) as ProductSourcePlanV1 }
  catch { throw new Error('[game-production-source] SourcePlan JSON 损坏；必须重新保存 Brief') }
  const plan = await validateProductSourcePlanV1(value)
  if (plan.planHash !== row.sourcePlanHash) {
    throw new Error('[game-production-source] SourcePlan row/hash 不一致')
  }
  return plan
}

export async function createGameConfirmedBriefV1(input: {
  productionKey: string
  briefRow: GameProductionBriefRecordV1
  sourcePlan: ProductSourcePlanV1
  authorStartRevision: number
  confirmedAt?: number
}): Promise<ConfirmedProductBriefV1> {
  const parsedBrief = JSON.parse(input.briefRow.briefJson) as GameProductionBriefV3
  return createConfirmedProductBriefV1({
    productType: parsedBrief.intent.productType,
    productInstanceKey: input.productionKey,
    sourcePlan: input.sourcePlan,
    briefRevision: input.briefRow.revision,
    briefContentHash: input.briefRow.briefHash,
    authorStartRevision: input.authorStartRevision,
    confirmedAt: input.confirmedAt,
  })
}

export async function parseGameConfirmedBriefV1(input: {
  row: Pick<GameProductionBriefRecordV1, 'confirmedBriefJson' | 'confirmedBriefHash'>
  sourcePlan: ProductSourcePlanV1
}): Promise<ConfirmedProductBriefV1> {
  let value: ConfirmedProductBriefV1
  try { value = JSON.parse(input.row.confirmedBriefJson) as ConfirmedProductBriefV1 }
  catch { throw new Error('[game-production-source] ConfirmedBrief JSON 损坏') }
  const brief = await validateConfirmedProductBriefV1({ brief: value, sourcePlan: input.sourcePlan })
  if (brief.confirmationHash !== input.row.confirmedBriefHash) {
    throw new Error('[game-production-source] ConfirmedBrief row/hash 不一致')
  }
  return brief
}

export function gameProductionWorldQueryV1(brief: GameProductionBriefV3, taskKey: string): string {
  return unique([
    taskKey,
    brief.intent.openingSituation,
    ...brief.intent.coreExperience,
    ...brief.intent.requiredFacts,
    ...brief.intent.forbiddenChanges,
    ...brief.intent.protagonistRefs,
  ].map(value => value.trim()).filter(Boolean)).join('；').slice(0, 4_000)
}

/** Execute one production task against the exact frozen SourcePlan boundary. */
export async function executeGameProductionWorldGatewayV1(input: {
  scope: WorkspaceScope
  sourcePlan: ProductSourcePlanV1
  brief: GameProductionBriefV3
  task: GameProductionPlanTaskV3
  budgetTokens: number
  requireCompilationResources?: boolean
  signal?: AbortSignal
}): Promise<ContextGatewayExecutionV1> {
  const skill = getAgentSkillV1(input.task.skillId ?? 'game-production.integrate.v1')
  const boundary = await resolveProductSourceReadBoundaryV1(input.sourcePlan)
  const compilationDescriptors = input.requireCompilationResources
    ? resolveGameProductionWorldCompilationDescriptorsV2({
      descriptors: (await openWorldSemanticResourceCatalogV1({
        localReleaseRecordId: input.brief.source.worldReleaseId,
        expectedProjectId: input.scope.projectId,
        expectedWorldId: input.scope.worldId,
      })).resources,
      selection: input.brief.source.selection,
    })
    : []
  const compilationResources = compilationDescriptors.map(descriptor => descriptor.resourceKey)
  const allowed = new Set(boundary.allowedResourceKeys)
  const forbiddenCompilationResources = compilationDescriptors.filter(descriptor => !allowed.has(descriptor.resourceKey))
  if (forbiddenCompilationResources.length) {
    throw new Error(`[game-production-source] 集成任务选择越过冻结 SourcePlan permission:${forbiddenCompilationResources
      .map(descriptor => `${descriptor.worldSemantic!.area}/${descriptor.worldSemantic!.resourceKind}/${descriptor.resourceKey}`)
      .join(',')}`)
  }
  const mandatoryResourceKeys = unique([...boundary.mandatoryResourceKeys, ...compilationResources])
  return executeContextGatewayV1({
    skill,
    scope: input.scope,
    resourceScope: boundary.sourceScope,
    accessPolicyOverride: input.sourcePlan.gatewayPolicy,
    allowedResourceKeys: boundary.allowedResourceKeys,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys: unique([...boundary.mandatoryFullResourceKeys, ...compilationResources]),
    mandatoryOriginalResourceKeys: unique(compilationResources),
    targetResourceKeys: unique([...boundary.targetResourceKeys, ...compilationResources]),
    query: gameProductionWorldQueryV1(input.brief, input.task.taskKey),
    budgetTokens: Math.max(1, Math.min(input.budgetTokens, input.sourcePlan.gatewayPolicy.maxRetrievedTokens)),
    additionalReadsEnabled: false,
    signal: input.signal,
  })
}

export function gameProductTypeFromBriefV1(brief: GameProductionBriefV3): GameProductType {
  return brief.intent.productType
}
