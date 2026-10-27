import { getAgentSkillV1 } from '../agent/skill-registry'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { openWorldSemanticResourceCatalogV1, openProductWorldResourceCatalogV2, closeProductWorldResourceCatalogV2 } from '../context-gateway/world-release-client'
import type {
  ConfirmedProductBriefV1,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductionProductKindV1,
  ProductSourcePlan,
  ProductSourcePlanV1,
  WorkspaceScope,
} from '../types'
import {
  createConfirmedProductBriefV1 as createConfirmedProductBriefContractV1,
  freezeProductSourcePlanV1,
  createProductSourcePlanBasisV2,
  resolveProductSourceReadBoundary,
  type ProductSourceReadBoundaryV1,
  validateConfirmedProductBriefV1,
  validateProductSourcePlan,
} from '../product/source-contracts'
import {
  getUpperProductWorldRequirementAdapterV1,
  CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V2, AVG_WORLD_REQUIREMENT_ADAPTER_V2,
  type UpperProductWorldRequirementGoalV1,
} from '../product/world-requirement-adapters'
import { freezeExactProductSourcePlanV2, refreezeExactProductSourcePlanBriefV2 } from '../product/exact-source-contracts'
import { hashProductProductionValueV2 } from './hash'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from './world-source'
import { textAdventureMandatoryFullWorldResourcesV1 } from '../adventure/world-source-requirements'
import { verifyTtrpgOpenProductionSourcePlanV1 } from '../ttrpg/production-source-plan'

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[]
}

function selectedDescriptors(input: {
  brief: ProductProductionBriefV3
  descriptors: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources']
}) {
  const selected = new Set(input.brief.source.selection.resourceKeys)
  const rows = input.descriptors.filter(descriptor => selected.has(descriptor.resourceKey))
  if (rows.length !== selected.size) {
    throw new Error('[product-production-source] Brief 选择包含不属于冻结 WorldRelease 的资源')
  }
  return rows
}

function requirementGoal(input: {
  brief: ProductProductionBriefV3
  descriptors: ReturnType<typeof selectedDescriptors>
}): UpperProductWorldRequirementGoalV1 {
  const participantKeys = input.brief.source.selection.roleBindings.participants
    ?? input.brief.source.selection.roleBindings.characters
    ?? input.brief.source.selection.roleBindings.residents
    ?? []
  const selectedKinds = new Set(input.descriptors.map(item => item.worldSemantic!.resourceKind))
  const selectedAreas = unique(input.descriptors.map(item => item.worldSemantic!.area))
  const narrative = input.descriptors.some(item => item.worldSemantic?.narrative)
  return {
    ...(narrative ? { semanticContract: 4 as const } : {}),
    selectedAreas,
    selectedResourceKinds: unique([...selectedKinds]),
    selectedContextKinds: unique(input.descriptors.map(item => item.kind)),
    selectedResourceCount: input.descriptors.length,
    participantCount: unique(participantKeys).length,
    includeSelectedRelations: input.descriptors.filter(item => (
      item.kind === 'character'
    )).length > 1,
    inheritStoryContinuity: narrative ? selectedAreas.some(area => ['story', 'storylines', 'manuscript'].includes(area)) : [...selectedKinds].some(kind => [
      'story-core', 'story-arc', 'storyline-progress', 'outline-node',
      'detailed-outline', 'chapter', 'foreshadow',
    ].includes(kind)),
    allowCrossWorld: selectedAreas.includes('multi-world'),
  }
}

export async function createProductProductionSourcePlanV1(input: {
  scope: WorkspaceScope
  productionKey: string
  brief: ProductProductionBriefV3
  createdAt?: number
  /** Registry-remapped locator of an already persisted immutable open Brief; content bytes/hashes stay unchanged. */
  verifiedSourcePlan?: ProductSourcePlanV1
}): Promise<ProductSourcePlan> {
  if (input.brief.ttrpgOpen) {
    return verifyTtrpgOpenProductionSourcePlanV1(input)
  }
  const catalog = await openProductWorldResourceCatalogV2({
    productType: input.brief.intent.productType,
    localReleaseRecordId: input.brief.source.worldReleaseId,
    expectedProjectId: input.scope.projectId,
    expectedWorldId: input.scope.worldId,
  })
  try {
    if (catalog.description.identity.releaseHash !== input.brief.source.worldContentHash) {
      throw new Error('[product-production-source] Brief 的 WorldRelease hash 已过期')
    }
    if (input.brief.source.selection.version !== catalog.description.worldReference.version
      || input.brief.source.selection.worldReferenceHash !== catalog.description.worldReference.referenceHash) {
      throw new Error('[product-production-source] 选择的版本或身份与冻结世界不一致')
    }
    const descriptors = selectedDescriptors({ brief: input.brief, descriptors: catalog.resources })
    if (!descriptors.length) {
      throw new Error('[product-production-source] 正式产品至少需要一个作者冻结的世界资源')
    }
    const productType = input.brief.intent.productType
    const adapter = productType === 'character-interaction' ? CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V2
      : productType === 'avg' ? AVG_WORLD_REQUIREMENT_ADAPTER_V2
        : getUpperProductWorldRequirementAdapterV1(productType)
    const goal = requirementGoal({ brief: input.brief, descriptors })
    const roleAnchors = Object.values(input.brief.source.selection.roleBindings)
      .flatMap(keys => keys.slice(0, 3))
    const initialResourceKeys = unique([
      ...input.brief.source.startingPoint.sourceRefs,
      ...input.brief.source.startingPoint.protagonistRefs,
      ...input.brief.intent.protagonistRefs,
      ...roleAnchors,
    ]).filter(key => input.brief.source.selection.resourceKeys.includes(key))
    if (!initialResourceKeys.length) initialResourceKeys.push(input.brief.source.selection.resourceKeys[0]!)
    const reference = catalog.description.worldReference
    const common = {
      productInstanceKey: input.productionKey,
      adapter,
      goal,
      missingStrategy: 'block' as const,
      initialResourceKeys,
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'] as import('../registry/types').ContextResourceDepthV1[],
      maxReadCalls: productType === 'character-interaction' || productType === 'avg'
        ? getAgentSkillV1('product-production.integrate.v1').contextGateway!.maxReadCalls
        : Math.min(20_000, Math.max(200, descriptors.length + 50)),
      maxRetrievedTokens: Math.min(100_000, Math.max(1, input.brief.productionBudget.maximumInputTokens)),
      createdAt: input.createdAt,
    }
    const base = reference.version === 1 ? await freezeProductSourcePlanV1({ ...common, worldReference: reference }) : null
    if (productType !== 'character-interaction' && productType !== 'avg') {
      if (!base) throw new Error('[product-production-source] 此产品尚未登记 v4 编译器')
      return base
    }
    const basis = base ? null : await createProductSourcePlanBasisV2({ ...common, worldReference: reference, descriptors: catalog.resources })
    return await freezeExactProductSourcePlanV2({ ...(base ? { base } : { basis: basis! }), briefHash: await hashProductProductionValueV2(input.brief),
      configuration: { inheritStoryContinuity: goal.inheritStoryContinuity, allowCrossWorld: goal.allowCrossWorld,
        roleBindings: input.brief.source.selection.roleBindings },
      authorResourceKeys: input.brief.source.selection.resourceKeys, descriptors: catalog.resources })
  } finally { await closeProductWorldResourceCatalogV2(catalog) }
}

export function productProductionTaskUsesWorldGatewayV1(task: ProductProductionPlanTaskV3): boolean {
  const isDeterministicIntegration = task.executionMode === 'deterministic'
    && task.kind === 'runtime-package'
  const skill = getAgentSkillV1(task.skillId ?? 'product-production.integrate.v1')
  return skill.contextGateway?.providerSourceKeys.includes('worldRelease') === true
    && (task.executionMode === 'model' || task.skillId === 'product-production.integrate.v1'
      || isDeterministicIntegration)
}

/** P1 must split the complete frozen source selection into bounded model
 * batches. Its executor therefore owns the per-batch Gateway attempts and
 * exact ContextManifestV3 evidence instead of accepting one synthetic outer
 * scheduler packet that no individual model call actually read. */
export function productProductionTaskOwnsWorldGatewayV1(task: ProductProductionPlanTaskV3): boolean {
  return task.taskKey === 'p1.source-curation'
    && task.skillId === 'text-open-world.production.source-curation.v1'
    && task.executionMode === 'model'
}

export async function parseProductProductionSourcePlanV1(
  row: Pick<ProductProductionBriefRecordV1, 'sourcePlanJson' | 'sourcePlanHash' | 'briefJson' | 'briefHash'>,
): Promise<ProductSourcePlan> {
  let value: ProductSourcePlan
  try { value = JSON.parse(row.sourcePlanJson) as ProductSourcePlan }
  catch { throw new Error('[product-production-source] SourcePlan JSON 损坏；必须重新保存 Brief') }
  const plan = await validateProductSourcePlan(value)
  if (plan.planHash !== row.sourcePlanHash) {
    throw new Error('[product-production-source] SourcePlan row/hash 不一致')
  }
  if (plan.version === 2 && (plan.compiler.briefHash !== row.briefHash
    || await hashProductProductionValueV2(JSON.parse(row.briefJson)) !== row.briefHash)) {
    throw new Error('[product-production-source] Brief 内容与精确 SourcePlan 不一致')
  }
  return plan
}

/** Evolution creates a new Brief but cannot silently expand its frozen world
 * selection. Pure hashing only; safe before committing the new draft revision. */
export async function refreezeProductProductionEvolutionSourcePlanV2(input: {
  previous: ProductProductionBriefRecordV1
  nextBrief: ProductProductionBriefV3
  createdAt: number
}): Promise<ProductSourcePlan> {
  const plan = await parseProductProductionSourcePlanV1(input.previous)
  if (plan.version === 1) return plan
  const prior = JSON.parse(input.previous.briefJson) as ProductProductionBriefV3
  if (input.nextBrief.intent.productType !== prior.intent.productType
    || input.nextBrief.source.worldContentHash !== prior.source.worldContentHash
    || await hashProductProductionValueV2(input.nextBrief.source.selection) !== await hashProductProductionValueV2(prior.source.selection)
    || input.nextBrief.source.worldReleaseId !== input.previous.sourceWorldReleaseId) {
    throw new Error('[product-production-source] 演化改变了来源选择；必须重新确认世界来源计划')
  }
  return refreezeExactProductSourcePlanBriefV2({ plan, briefHash: await hashProductProductionValueV2(input.nextBrief), createdAt: input.createdAt })
}

export async function createConfirmedProductBriefV1(input: {
  productionKey: string
  briefRow: ProductProductionBriefRecordV1
  sourcePlan: ProductSourcePlan
  authorStartRevision: number
  confirmedAt?: number
}): Promise<ConfirmedProductBriefV1> {
  const parsedBrief = JSON.parse(input.briefRow.briefJson) as ProductProductionBriefV3 | {
    schema: 'storyforge.ttrpg-production-brief'
    version: 3
    runFormat: 'open'
  }
  const productType = parsedBrief.schema === 'storyforge.ttrpg-production-brief'
    && parsedBrief.version === 3
    && parsedBrief.runFormat === 'open'
    ? 'ttrpg'
    : (parsedBrief as ProductProductionBriefV3).intent.productType
  return createConfirmedProductBriefContractV1({
    productType,
    productInstanceKey: input.productionKey,
    sourcePlan: input.sourcePlan,
    briefRevision: input.briefRow.revision,
    briefContentHash: input.briefRow.briefHash,
    authorStartRevision: input.authorStartRevision,
    confirmedAt: input.confirmedAt,
  })
}

export async function parseConfirmedProductBriefV1(input: {
  row: Pick<ProductProductionBriefRecordV1, 'confirmedBriefJson' | 'confirmedBriefHash'>
  sourcePlan: ProductSourcePlan
}): Promise<ConfirmedProductBriefV1> {
  let value: ConfirmedProductBriefV1
  try { value = JSON.parse(input.row.confirmedBriefJson) as ConfirmedProductBriefV1 }
  catch { throw new Error('[product-production-source] ConfirmedBrief JSON 损坏') }
  const brief = await validateConfirmedProductBriefV1({ brief: value, sourcePlan: input.sourcePlan })
  if (brief.confirmationHash !== input.row.confirmedBriefHash) {
    throw new Error('[product-production-source] ConfirmedBrief row/hash 不一致')
  }
  return brief
}

export function productProductionWorldQueryV1(brief: ProductProductionBriefV3, taskKey: string): string {
  return unique([
    taskKey,
    brief.intent.openingSituation,
    ...brief.intent.coreExperience,
    ...brief.intent.requiredFacts,
    ...brief.intent.forbiddenChanges,
    ...brief.intent.protagonistRefs,
  ].map(value => value.trim()).filter(Boolean)).join('；').slice(0, 4_000)
}

/** Product production is allowed to read only the exact frozen product
 * selection (plus an explicitly frozen dependency closure). The generic
 * SourcePlan permission is a semantic upper bound, not authorization to pull
 * every record of the same kind from the WorldRelease. */
export function narrowProductProductionReadBoundaryV1(input: {
  boundary: ProductSourceReadBoundaryV1
  selectionResourceKeys: readonly string[]
  dependencyClosureResourceKeys?: readonly string[]
}): ProductSourceReadBoundaryV1 {
  const authorized = new Set(unique([
    ...input.selectionResourceKeys,
    ...(input.dependencyClosureResourceKeys ?? []),
  ]))
  const permitted = new Set(input.boundary.allowedResourceKeys)
  const outside = [...authorized].filter(key => !permitted.has(key))
  if (outside.length) {
    throw new Error(`[product-production-source] 冻结产品选择越过 SourcePlan permission:${outside.join(',')}`)
  }
  const allowedResourceKeys = input.boundary.allowedResourceKeys.filter(key => authorized.has(key))
  if (!allowedResourceKeys.length) throw new Error('[product-production-source] 冻结产品选择为空')
  const allowed = new Set(allowedResourceKeys)
  return {
    sourceScope: input.boundary.sourceScope,
    allowedResourceKeys,
    mandatoryResourceKeys: input.boundary.mandatoryResourceKeys.filter(key => allowed.has(key)),
    mandatoryFullResourceKeys: input.boundary.mandatoryFullResourceKeys.filter(key => allowed.has(key)),
    targetResourceKeys: input.boundary.targetResourceKeys.filter(key => allowed.has(key)),
  }
}

/** Execute one production task against the exact frozen SourcePlan boundary. */
export async function executeProductProductionWorldGatewayV1(input: {
  scope: WorkspaceScope
  sourcePlan: ProductSourcePlan
  brief: ProductProductionBriefV3
  task: ProductProductionPlanTaskV3
  budgetTokens: number
  requireCompilationResources?: boolean
  signal?: AbortSignal
}): Promise<ContextGatewayExecutionV1> {
  const skill = getAgentSkillV1(input.task.skillId ?? 'product-production.integrate.v1')
  if (input.sourcePlan.version === 2 && input.sourcePlan.compiler.briefHash !== await hashProductProductionValueV2(input.brief)) {
    throw new Error('[product-production-source] Brief 条件已改变，必须重新确认精确 SourcePlan')
  }
  const compilationCatalog = input.requireCompilationResources ? await openProductWorldResourceCatalogV2({
    localReleaseRecordId: input.sourcePlan.worldReference.localReleaseRecordId,
    expectedProjectId: input.scope.projectId, expectedWorldId: input.scope.worldId,
    productType: input.brief.intent.productType, sourcePlan: input.sourcePlan,
  }) : null
  const compilationDescriptors = compilationCatalog ? resolveProductProductionWorldCompilationDescriptorsV2({
    descriptors: compilationCatalog.resources, selection: input.brief.source.selection,
  }) : []
  if (compilationCatalog) await closeProductWorldResourceCatalogV2(compilationCatalog)
  const compilationResources = compilationDescriptors.map(descriptor => descriptor.resourceKey)
  const resolvedBoundary = await resolveProductSourceReadBoundary(input.sourcePlan)
  const exactSlice = input.sourcePlan.version === 2 ? input.sourcePlan.exact.slices.find(slice => slice.key === (
    input.task.kind === 'runtime-package' || input.requireCompilationResources ? 'integration'
      : ['narrative', 'product-module'].includes(input.task.kind) ? 'content' : 'adaptation'
  ))! : null
  const boundary = exactSlice ? { ...resolvedBoundary, allowedResourceKeys: [...exactSlice.resourceKeys],
    mandatoryResourceKeys: [...exactSlice.resourceKeys], mandatoryFullResourceKeys: [...exactSlice.resourceKeys],
    targetResourceKeys: [...exactSlice.resourceKeys] } : narrowProductProductionReadBoundaryV1({
    boundary: resolvedBoundary,
    selectionResourceKeys: input.brief.source.selection.resourceKeys,
    // Model-authored tasks receive only the author's explicit selection. The
    // deterministic compiler may additionally receive the relation/category
    // closure derived from the same immutable WorldRelease; it is still
    // intersected with the frozen SourcePlan permission below.
    dependencyClosureResourceKeys: [
      ...(input.brief.aiTown?.sourceSelection.dependencyClosureResourceKeys ?? []),
      ...compilationResources,
    ],
  })
  const allowed = new Set(boundary.allowedResourceKeys)
  const forbiddenCompilationResources = compilationDescriptors.filter(descriptor => !allowed.has(descriptor.resourceKey))
  if (forbiddenCompilationResources.length) {
    throw new Error(`[product-production-source] 集成任务选择越过冻结 SourcePlan permission:${forbiddenCompilationResources
      .map(descriptor => `${descriptor.worldSemantic!.area}/${descriptor.worldSemantic!.resourceKind}/${descriptor.resourceKey}`)
      .join(',')}`)
  }
  const specialistFullResources = textAdventureMandatoryFullWorldResourcesV1({
    productType: input.brief.intent.productType,
    selection: input.brief.source.selection,
    task: input.task,
  })
  const mandatoryResourceKeys = unique([
    ...boundary.mandatoryResourceKeys, ...compilationResources, ...specialistFullResources,
    ...(input.brief.ttrpgOpen && ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer']
      .includes(input.task.taskKey) ? input.brief.source.selection.resourceKeys : []),
  ])
  return executeContextGatewayV1({
    skill,
    scope: input.scope,
    resourceScope: boundary.sourceScope,
    worldQueryAccess: boundary.worldQueryAccess,
    accessPolicyOverride: input.sourcePlan.gatewayPolicy,
    allowedResourceKeys: boundary.allowedResourceKeys,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys: unique([
      ...boundary.mandatoryFullResourceKeys, ...compilationResources, ...specialistFullResources,
      ...(input.brief.ttrpgOpen && ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer']
        .includes(input.task.taskKey) ? input.brief.source.selection.resourceKeys : []),
    ]),
    mandatoryOriginalResourceKeys: input.sourcePlan.version === 2 ? mandatoryResourceKeys : unique(compilationResources),
    targetResourceKeys: unique([...boundary.targetResourceKeys, ...compilationResources]),
    query: productProductionWorldQueryV1(input.brief, input.task.taskKey),
    budgetTokens: Math.max(1, Math.min(input.budgetTokens, input.sourcePlan.gatewayPolicy.maxRetrievedTokens)),
    additionalReadsEnabled: false,
    signal: input.signal,
  })
}

export function productTypeFromBriefV1(brief: ProductProductionBriefV3): ProductionProductKindV1 {
  return brief.intent.productType
}
