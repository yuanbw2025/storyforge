import { hashCanonicalValue } from '../agent/run/hash'
import type { AgentContextTaskKind } from '../agent/context-policy'
import { readContextGatewayManifestV3ForAttemptV1 } from '../context-gateway/attempt-evidence'
import { getContextSelectorPolicyV1 } from '../context-gateway/selector'
import { createContextGatewayToolSessionV1 } from '../context-gateway/tool-session'
import { WORLD_RELEASE_RESOURCE_PROVIDER_V1, listAllWorldReleaseResourceDescriptorsV1 } from '../context-gateway/world-release-provider'
import { db } from '../db/schema'
import type {
  ContextManifestPointerV1,
  LocalContextManifestAttemptV1,
  ConfirmedProductBriefV1,
  ProductReleaseLineageV1,
  ProductSourceManifestResourceV1,
  ProductSourceManifestV1,
  ProductSourceMissingStrategyV1,
  ProductSourcePlanV1,
  UpperProductKindV1,
  WorkspaceScope,
  WorldReferenceV1,
  WorldRequirementAdapterSnapshotV1,
  WorldResourceSelectorV1,
  WorldRequirementResolutionV1,
  WorldRequirementRuleV1,
  WorldRequirementStatusV1,
} from '../types'
import type {
  ContextResourceDescriptorV1,
  ContextResourceDepthV1,
  FrozenResourceScopeV1,
  RetrievalDecisionV1,
} from '../registry/types'
import { validateWorldReferenceV1 } from './world-reference'

const HASH = /^[a-f0-9]{64}$/
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

export interface WorldRequirementAdapterV1<TGoal> {
  adapterId: string
  adapterVersion: number
  productType: UpperProductKindV1
  contextTaskKind: AgentContextTaskKind
  resolve(goal: TGoal): WorldRequirementRuleV1[]
}

export class ProductSourceContractErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[product-source-contract:${code}] ${message}`)
    this.name = 'ProductSourceContractErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new ProductSourceContractErrorV1(code, message)
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[]
}

function assertHash(value: string, label: string): void {
  if (!HASH.test(value)) fail('hash', `${label} 必须是 SHA-256`)
}

function assertStableKey(value: string, label: string): void {
  if (!KEY.test(value)) fail('key', `${label} 不是稳定 key`)
}

function requirementMatches(
  requirement: WorldRequirementRuleV1,
  descriptor: ContextResourceDescriptorV1,
): boolean {
  const semantic = descriptor.worldSemantic
  if (!semantic) return false
  if (requirement.selector.areas.length && !requirement.selector.areas.includes(semantic.area)) return false
  if (requirement.selector.resourceKinds.length
    && !requirement.selector.resourceKinds.includes(semantic.resourceKind)) return false
  if (requirement.selector.contextKinds.length
    && !requirement.selector.contextKinds.includes(descriptor.kind)) return false
  const query = requirement.selector.query?.trim().toLocaleLowerCase('zh-CN')
  if (!query) return true
  return [descriptor.title, descriptor.shortSummary, semantic.area, semantic.resourceKind]
    .join('\n').toLocaleLowerCase('zh-CN').includes(query)
}

function normalizeRequirement(rule: WorldRequirementRuleV1): WorldRequirementRuleV1 {
  assertStableKey(rule.key, 'requirement.key')
  if (!rule.label.trim()) fail('requirement', `${rule.key} 缺少 label`)
  if (!Number.isSafeInteger(rule.minimumResources) || rule.minimumResources < 0) {
    fail('requirement', `${rule.key}.minimumResources 非法`)
  }
  if (rule.level === 'stable-required' && rule.minimumResources < 1) {
    fail('requirement', `${rule.key} 必读需求必须至少要求一个资源`)
  }
  if ((rule.level === 'conditional') !== (rule.condition != null)) {
    fail('requirement', `${rule.key} conditional 与 condition 必须同时出现`)
  }
  return {
    ...rule,
    label: rule.label.trim(),
    selector: {
      areas: uniqueSorted(rule.selector.areas),
      resourceKinds: uniqueSorted(rule.selector.resourceKinds),
      contextKinds: uniqueSorted(rule.selector.contextKinds),
      query: rule.selector.query?.trim() || null,
    },
    condition: rule.condition == null ? null : {
      key: rule.condition.key.trim(),
      active: rule.condition.active,
      reason: rule.condition.reason.trim(),
    },
  }
}

function resolveRequirement(
  rule: WorldRequirementRuleV1,
  descriptors: readonly ContextResourceDescriptorV1[],
): WorldRequirementResolutionV1 {
  const inactive = rule.level === 'conditional' && !rule.condition?.active
  const prohibited = rule.level === 'prohibited'
  if (inactive || prohibited) {
    return {
      ...rule,
      status: 'omitted',
      matchedResourceKeys: [],
      availableResourceCount: 0,
      reasonCodes: [inactive ? 'condition-not-active' : 'prohibited-by-product-adapter'],
    }
  }
  const matches = descriptors.filter(descriptor => requirementMatches(rule, descriptor))
  const status: WorldRequirementStatusV1 = matches.length === 0
    ? 'missing'
    : matches.length < rule.minimumResources
      ? 'insufficient'
      : 'matched'
  return {
    ...rule,
    status,
    matchedResourceKeys: matches.map(item => item.resourceKey).sort(),
    availableResourceCount: matches.length,
    reasonCodes: status === 'matched'
      ? ['catalog-match']
      : status === 'missing'
        ? ['no-matching-world-resource']
        : ['below-minimum-resource-count'],
  }
}

function selectorMatches(
  selector: WorldResourceSelectorV1,
  descriptor: ContextResourceDescriptorV1,
): boolean {
  return requirementMatches({
    key: 'permission-check',
    label: 'permission-check',
    level: 'recommended',
    selector,
    minimumResources: 0,
    condition: null,
  }, descriptor)
}

function permissionFromRequirements(
  requirements: readonly WorldRequirementResolutionV1[],
  allowedDepths: ContextResourceDepthV1[],
): ProductSourcePlanV1['permission'] {
  const active = requirements.filter(item => item.level !== 'prohibited'
    && !(item.level === 'conditional' && !item.condition?.active))
  const prohibited = requirements.filter(item => item.level === 'prohibited')
  return {
    allowedSelectors: active.map(item => structuredClone(item.selector)),
    prohibitedSelectors: prohibited.map(item => structuredClone(item.selector)),
    allowedAreas: uniqueSorted(active.flatMap(item => item.selector.areas)),
    allowedResourceKinds: uniqueSorted(active.flatMap(item => item.selector.resourceKinds)),
    allowedContextKinds: uniqueSorted(active.flatMap(item => item.selector.contextKinds)),
    allowedDepths,
    prohibitedAreas: uniqueSorted(prohibited.flatMap(item => item.selector.areas)),
    prohibitedResourceKinds: uniqueSorted(prohibited.flatMap(item => item.selector.resourceKinds)),
  }
}

function portableSourcePlanBodyV1(
  body: Omit<ProductSourcePlanV1, 'planHash'>,
): unknown {
  const { localReleaseRecordId: _localLocator, ...portableWorldReference } = body.worldReference
  return { ...body, worldReference: portableWorldReference }
}

export async function worldReferenceResourceScopeV1(
  referenceInput: WorldReferenceV1,
): Promise<FrozenResourceScopeV1> {
  const reference = await validateWorldReferenceV1(referenceInput)
  const release = await db.worldReleases.get(reference.localReleaseRecordId)
  if (!release) fail('release-missing', 'WorldReference 指向的本地 release 不存在')
  return {
    projectId: release.projectId,
    worldId: release.worldId,
    worldReleaseId: release.id,
    worldReleaseHash: release.contentHash,
  }
}

function readiness(input: {
  requirements: readonly WorldRequirementResolutionV1[]
  missingStrategy: ProductSourceMissingStrategyV1
}): ProductSourcePlanV1['readiness'] {
  const hardGaps = input.requirements.filter(item => item.level === 'stable-required'
    && (item.status === 'missing' || item.status === 'insufficient' || item.status === 'conflict'))
  if (!hardGaps.length) return 'ready'
  return input.missingStrategy === 'block' || input.missingStrategy === 'ask-author'
    ? 'blocked'
    : 'ready-with-gaps'
}

export async function freezeProductSourcePlanV1<TGoal>(input: {
  productInstanceKey: string
  worldReference: WorldReferenceV1
  adapter: WorldRequirementAdapterV1<TGoal>
  goal: TGoal
  missingStrategy: ProductSourceMissingStrategyV1
  consultationContextManifests?: ContextManifestPointerV1[]
  initialResourceKeys?: string[]
  allowedDepths?: ContextResourceDepthV1[]
  maxReadCalls?: number
  maxRetrievedTokens?: number
  createdAt?: number
}): Promise<ProductSourcePlanV1> {
  assertStableKey(input.productInstanceKey, 'productInstanceKey')
  assertStableKey(input.adapter.adapterId, 'adapterId')
  if (!Number.isSafeInteger(input.adapter.adapterVersion) || input.adapter.adapterVersion < 1) {
    fail('adapter', 'adapterVersion 必须是正整数')
  }
  const worldReference = await validateWorldReferenceV1(input.worldReference)
  const scope = await worldReferenceResourceScopeV1(worldReference)
  const descriptors = await listAllWorldReleaseResourceDescriptorsV1(scope)
  const rules = input.adapter.resolve(input.goal).map(normalizeRequirement)
  if (!rules.length || new Set(rules.map(item => item.key)).size !== rules.length) {
    fail('adapter', '需求适配器必须返回非空且 key 唯一的规则')
  }
  const requirements = rules.map(rule => resolveRequirement(rule, descriptors))
  const active = requirements.filter(item => item.level !== 'prohibited'
    && !(item.level === 'conditional' && !item.condition?.active))
  const allowedContextKinds = uniqueSorted(active.flatMap(item => item.selector.contextKinds))
  if (!allowedContextKinds.length) fail('adapter', '适配器没有声明任何可读 Context kind')
  const allowedDepths = uniqueSorted(input.allowedDepths ?? ['index', 'summary', 'focused', 'full', 'original'])
  const gatewayPolicy = {
    version: 'context-access-policy-v1' as const,
    policyId: `world-source-plan:${input.adapter.adapterId}:v${input.adapter.adapterVersion}`,
    mandatorySourceKeys: ['worldRelease'],
    allowedSourceKeys: ['worldRelease'],
    allowedResourceKinds: allowedContextKinds,
    allowedDepths,
    selectorPolicyId: getContextSelectorPolicyV1(input.adapter.contextTaskKind).selectorPolicyId,
    maxReadCalls: input.maxReadCalls ?? 200,
    maxRetrievedTokens: input.maxRetrievedTokens ?? 100_000,
    allowOriginalRead: allowedDepths.includes('original'),
    candidateAccess: 'forbidden' as const,
  }
  const adapter: WorldRequirementAdapterSnapshotV1 = {
    adapterId: input.adapter.adapterId,
    adapterVersion: input.adapter.adapterVersion,
    productType: input.adapter.productType,
    contextTaskKind: input.adapter.contextTaskKind,
    contractHash: await hashCanonicalValue({
      adapterId: input.adapter.adapterId,
      adapterVersion: input.adapter.adapterVersion,
      productType: input.adapter.productType,
      contextTaskKind: input.adapter.contextTaskKind,
      rules,
    }),
  }
  const consultationContextManifests = [...(input.consultationContextManifests ?? [])]
    .sort((left, right) => left.manifestHash.localeCompare(right.manifestHash)
      || left.stepId.localeCompare(right.stepId) || left.attempt - right.attempt)
  for (const pointer of consultationContextManifests) {
    if (!pointer.stepId.trim() || !Number.isSafeInteger(pointer.attempt) || pointer.attempt < 1) {
      fail('manifest-pointer', '咨询 Context Manifest 指针非法')
    }
    assertHash(pointer.manifestHash, 'consultation.manifestHash')
  }
  const gatewayPolicyHash = await hashCanonicalValue(gatewayPolicy)
  const descriptorByKey = new Map(descriptors.map(item => [item.resourceKey, item]))
  const initialResourceKeys = uniqueSorted(input.initialResourceKeys ?? [])
  for (const resourceKey of initialResourceKeys) {
    const descriptor = descriptorByKey.get(resourceKey)
    if (!descriptor) fail('initial-resource', `初始世界资源不属于 WorldReference:${resourceKey}`)
    const semantic = descriptor.worldSemantic
    if (!semantic || !active.some(item => selectorMatches(item.selector, descriptor))) {
      fail('initial-resource', `初始世界资源越过 adapter permission:${resourceKey}`)
    }
  }
  const base: Omit<ProductSourcePlanV1, 'planHash'> = {
    schema: 'storyforge.product-source-plan',
    version: 1,
    productType: input.adapter.productType,
    productInstanceKey: input.productInstanceKey,
    worldReference,
    adapter,
    requirements,
    initialResourceKeys,
    permission: permissionFromRequirements(requirements, allowedDepths),
    gatewayPolicy,
    gatewayPolicyHash,
    missingStrategy: input.missingStrategy,
    consultationContextManifests,
    readiness: readiness({ requirements, missingStrategy: input.missingStrategy }),
    createdAt: input.createdAt ?? Date.now(),
  }
  return { ...base, planHash: await hashCanonicalValue(portableSourcePlanBodyV1(base)) }
}

export async function validateProductSourcePlanV1(plan: ProductSourcePlanV1): Promise<ProductSourcePlanV1> {
  if (plan.schema !== 'storyforge.product-source-plan' || plan.version !== 1) fail('plan-contract', 'SourcePlan 合同身份无效')
  assertHash(plan.planHash, 'planHash')
  assertHash(plan.gatewayPolicyHash, 'gatewayPolicyHash')
  await validateWorldReferenceV1(plan.worldReference)
  const { planHash, ...body } = plan
  if (await hashCanonicalValue(portableSourcePlanBodyV1(body)) !== planHash
    || await hashCanonicalValue(plan.gatewayPolicy) !== plan.gatewayPolicyHash) {
    fail('plan-hash', 'SourcePlan 或 Gateway policy hash 不匹配')
  }
  const expectedPermission = permissionFromRequirements(plan.requirements, plan.permission.allowedDepths)
  if (await hashCanonicalValue(expectedPermission) !== await hashCanonicalValue(plan.permission)) {
    fail('plan-permission', 'SourcePlan permission 不是由冻结需求规则推导所得')
  }
  const normalizedReadiness = readiness({ requirements: plan.requirements, missingStrategy: plan.missingStrategy })
  if (normalizedReadiness !== plan.readiness) fail('plan-readiness', 'SourcePlan readiness 与必读缺口不一致')
  return structuredClone(plan)
}

export async function createConfirmedProductBriefV1(input: {
  productType: UpperProductKindV1
  productInstanceKey: string
  sourcePlan: ProductSourcePlanV1
  briefRevision: number
  briefContentHash: string
  authorStartRevision: number
  confirmedAt?: number
}): Promise<ConfirmedProductBriefV1> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  if (plan.productType !== input.productType || plan.productInstanceKey !== input.productInstanceKey) {
    fail('brief-owner', 'Brief owner 与 SourcePlan 不一致')
  }
  if (!Number.isSafeInteger(input.briefRevision) || input.briefRevision < 1
    || !Number.isSafeInteger(input.authorStartRevision) || input.authorStartRevision < 1) {
    fail('brief-revision', 'Brief/开始授权 revision 非法')
  }
  assertHash(input.briefContentHash, 'briefContentHash')
  const base: Omit<ConfirmedProductBriefV1, 'confirmationHash'> = {
    schema: 'storyforge.confirmed-product-brief', version: 1,
    productType: input.productType,
    productInstanceKey: input.productInstanceKey,
    sourcePlanHash: plan.planHash,
    briefRevision: input.briefRevision,
    briefContentHash: input.briefContentHash,
    authorStartRevision: input.authorStartRevision,
    confirmedBy: 'author',
    confirmedAt: input.confirmedAt ?? Date.now(),
  }
  return { ...base, confirmationHash: await hashCanonicalValue(base) }
}

export async function validateConfirmedProductBriefV1(input: {
  brief: ConfirmedProductBriefV1
  sourcePlan: ProductSourcePlanV1
}): Promise<ConfirmedProductBriefV1> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  const brief = input.brief
  if (brief.schema !== 'storyforge.confirmed-product-brief' || brief.version !== 1
    || brief.sourcePlanHash !== plan.planHash || brief.productType !== plan.productType
    || brief.productInstanceKey !== plan.productInstanceKey) fail('brief-contract', '确认 Brief 与 SourcePlan 不一致')
  const { confirmationHash, ...body } = brief
  assertHash(confirmationHash, 'confirmationHash')
  if (await hashCanonicalValue(body) !== confirmationHash) fail('brief-hash', '确认 Brief hash 不匹配')
  return structuredClone(brief)
}

function traceDecisions(manifest: Awaited<ReturnType<typeof readContextGatewayManifestV3ForAttemptV1>>['manifest']): RetrievalDecisionV1[] {
  return [
    ...manifest.gateway.retrievalTrace.mandatory,
    ...manifest.gateway.retrievalTrace.autoSelected,
    ...manifest.gateway.retrievalTrace.agentReads,
  ]
}

function resourceAllowed(plan: ProductSourcePlanV1, descriptor: ContextResourceDescriptorV1): boolean {
  const semantic = descriptor.worldSemantic
  if (!semantic) return false
  if (!plan.permission.allowedSelectors.some(selector => selectorMatches(selector, descriptor))) return false
  if (plan.permission.prohibitedSelectors.some(selector => selectorMatches(selector, descriptor))) return false
  return plan.permission.allowedAreas.includes(semantic.area)
    && plan.permission.allowedContextKinds.includes(descriptor.kind)
}

export interface ProductSourceReadBoundaryV1 {
  sourceScope: FrozenResourceScopeV1
  allowedResourceKeys: string[]
  mandatoryResourceKeys: string[]
  mandatoryFullResourceKeys: string[]
  targetResourceKeys: string[]
}

/** Resolve the concrete read boundary at execution time from the frozen
 * SourcePlan. The plan freezes selectors (the protocol); this projection
 * resolves those selectors against the immutable WorldRelease catalog without
 * exposing physical world tables to an upper product. */
export async function resolveProductSourceReadBoundaryV1(
  sourcePlanInput: ProductSourcePlanV1,
): Promise<ProductSourceReadBoundaryV1> {
  const plan = await validateProductSourcePlanV1(sourcePlanInput)
  const sourceScope = await worldReferenceResourceScopeV1(plan.worldReference)
  const descriptors = await listAllWorldReleaseResourceDescriptorsV1(sourceScope)
  const allowed = descriptors.filter(descriptor => resourceAllowed(plan, descriptor))
  const allowedKeys = new Set(allowed.map(item => item.resourceKey))
  const mandatory = new Set<string>()
  for (const resourceKey of plan.initialResourceKeys) {
    if (!allowedKeys.has(resourceKey)) fail('initial-resource', `冻结初始资源已越过 SourcePlan:${resourceKey}`)
    mandatory.add(resourceKey)
  }
  for (const requirement of plan.requirements) {
    if (requirement.level !== 'stable-required' || requirement.status !== 'matched') continue
    const matches = allowed.filter(descriptor => requirementMatches(requirement, descriptor))
      .sort((left, right) => {
        const leftInitial = plan.initialResourceKeys.includes(left.resourceKey) ? 0 : 1
        const rightInitial = plan.initialResourceKeys.includes(right.resourceKey) ? 0 : 1
        return leftInitial - rightInitial || left.resourceKey.localeCompare(right.resourceKey)
      })
    for (const descriptor of matches.slice(0, requirement.minimumResources)) mandatory.add(descriptor.resourceKey)
  }
  const mandatoryResourceKeys = [...mandatory].sort()
  return {
    sourceScope,
    allowedResourceKeys: [...allowedKeys].sort(),
    mandatoryResourceKeys,
    mandatoryFullResourceKeys: [...mandatoryResourceKeys],
    targetResourceKeys: [...plan.initialResourceKeys].sort(),
  }
}

interface MutableResourceEvidenceV1 {
  descriptor: ContextResourceDescriptorV1
  status: 'matched' | 'omitted'
  depths: Set<ContextResourceDepthV1>
  contentHashes: Set<string>
  sourceRefsHash: string | null
  contextManifestHashes: Set<string>
  reasonCodes: Set<string>
}

async function descriptorForTrace(input: {
  scope: FrozenResourceScopeV1
  resourceKey: string
}): Promise<ContextResourceDescriptorV1> {
  return (await WORLD_RELEASE_RESOURCE_PROVIDER_V1.read({
    scope: input.scope,
    resourceKey: input.resourceKey,
    depth: 'index',
    maxTokens: 1,
  })).descriptor
}

function addDecision(input: {
  map: Map<string, MutableResourceEvidenceV1>
  descriptor: ContextResourceDescriptorV1
  status: 'matched' | 'omitted'
  depth?: ContextResourceDepthV1
  contentHash?: string
  sourceRefsHash?: string | null
  manifestHash: string
  reasonCode: string
}): void {
  const existing = input.map.get(input.descriptor.resourceKey) ?? {
    descriptor: input.descriptor,
    status: input.status,
    depths: new Set<ContextResourceDepthV1>(),
    contentHashes: new Set<string>(),
    sourceRefsHash: input.sourceRefsHash ?? null,
    contextManifestHashes: new Set<string>(),
    reasonCodes: new Set<string>(),
  }
  if (input.status === 'matched') existing.status = 'matched'
  if (input.depth) existing.depths.add(input.depth)
  if (input.contentHash) existing.contentHashes.add(input.contentHash)
  if (input.sourceRefsHash) {
    if (existing.sourceRefsHash && existing.sourceRefsHash !== input.sourceRefsHash) {
      fail('source-ref-drift', `资源 ${input.descriptor.resourceKey} 在 run manifests 中的 SourceRefs 不一致`)
    }
    existing.sourceRefsHash = input.sourceRefsHash
  }
  existing.contextManifestHashes.add(input.manifestHash)
  existing.reasonCodes.add(input.reasonCode)
  input.map.set(input.descriptor.resourceKey, existing)
}

export async function aggregateProductSourceManifestFromExactRunsV1(input: {
  scope: WorkspaceScope
  sourcePlan: ProductSourcePlanV1
  runContextManifests: LocalContextManifestAttemptV1[]
  createdAt?: number
}): Promise<ProductSourceManifestV1> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  if (!input.runContextManifests.length) fail('run-manifest', '发布 SourceManifest 至少需要一个真实 production Context Manifest')
  const sourceScope = await worldReferenceResourceScopeV1(plan.worldReference)
  const readBoundary = await resolveProductSourceReadBoundaryV1(plan)
  const gatewaySession = await createContextGatewayToolSessionV1({
    scope: sourceScope,
    policy: plan.gatewayPolicy,
    allowedResourceKeys: readBoundary.allowedResourceKeys,
  })
  if (gatewaySession.policyHash !== plan.gatewayPolicyHash) fail('policy', '冻结 Gateway policy 与 SourcePlan 不一致')
  const resourceMap = new Map<string, MutableResourceEvidenceV1>()
  const pointers = [...input.runContextManifests]
    .sort((left, right) => left.runId - right.runId || left.stepId.localeCompare(right.stepId) || left.attempt - right.attempt)
  const pointerKeys = new Set<string>()
  for (const pointer of pointers) {
    const pointerKey = `${pointer.runId}:${pointer.stepId}:${pointer.attempt}`
    if (pointerKeys.has(pointerKey)) fail('run-manifest', `重复 Context Manifest attempt:${pointerKey}`)
    pointerKeys.add(pointerKey)
    assertHash(pointer.manifestHash, 'runContextManifest.manifestHash')
    const restored = await readContextGatewayManifestV3ForAttemptV1({
      scope: input.scope,
      runId: pointer.runId,
      stepId: pointer.stepId,
      attempt: pointer.attempt,
    })
    const manifest = restored.manifest
    if (manifest.manifestHash !== pointer.manifestHash
      || manifest.gateway.policyHash !== plan.gatewayPolicyHash
      || manifest.gateway.scopeFingerprint !== gatewaySession.scopeFingerprint) {
      fail('run-manifest-binding', `Run ${pointerKey} 未绑定 SourcePlan 的 release/policy`)
    }
    for (const decision of traceDecisions(manifest)) {
      if (decision.sourceKey !== 'worldRelease') continue
      const descriptor = await descriptorForTrace({ scope: sourceScope, resourceKey: decision.resourceKey })
      if (!resourceAllowed(plan, descriptor) || !plan.permission.allowedDepths.includes(decision.depth)) {
        fail('permission', `Run ${pointerKey} 越过 SourcePlan 读取 ${decision.resourceKey}`)
      }
      if (descriptor.contentHash !== decision.contentHash) fail('resource-drift', `${decision.resourceKey} contentHash 与冻结 release 不一致`)
      addDecision({
        map: resourceMap,
        descriptor,
        status: 'matched',
        depth: decision.depth,
        contentHash: decision.contentHash,
        sourceRefsHash: await hashCanonicalValue(decision.sourceRefs),
        manifestHash: manifest.manifestHash,
        reasonCode: decision.reason,
      })
    }
    for (const omission of manifest.gateway.retrievalTrace.omitted) {
      if (omission.sourceKey !== 'worldRelease') continue
      const descriptor = await descriptorForTrace({ scope: sourceScope, resourceKey: omission.resourceKey })
      if (!resourceAllowed(plan, descriptor)) continue
      addDecision({
        map: resourceMap,
        descriptor,
        status: 'omitted',
        manifestHash: manifest.manifestHash,
        reasonCode: omission.reasonCode,
      })
    }
  }
  const resources: ProductSourceManifestResourceV1[] = [...resourceMap.values()]
    .map(item => ({
      resourceKey: item.descriptor.resourceKey,
      area: item.descriptor.worldSemantic!.area,
      resourceKind: item.descriptor.worldSemantic!.resourceKind,
      status: item.status,
      depths: [...item.depths].sort(),
      contentHashes: [...item.contentHashes].sort(),
      sourceRefsHash: item.sourceRefsHash,
      contextManifestHashes: [...item.contextManifestHashes].sort(),
      reasonCodes: [...item.reasonCodes].sort(),
    }))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
  const matchedDescriptors = [...resourceMap.values()]
    .filter(item => item.status === 'matched')
    .map(item => item.descriptor)
  const requirementOutcomes = plan.requirements.map(requirement => {
    if (requirement.status !== 'matched') {
      return {
        requirementKey: requirement.key,
        status: requirement.status,
        evidenceResourceKeys: [] as string[],
        reasonCodes: [...requirement.reasonCodes],
      }
    }
    const evidence = matchedDescriptors.filter(descriptor => requirementMatches(requirement, descriptor))
      .map(item => item.resourceKey).sort()
    const status: WorldRequirementStatusV1 = evidence.length === 0
      ? 'omitted'
      : evidence.length < requirement.minimumResources
        ? 'insufficient'
        : 'matched'
    return {
      requirementKey: requirement.key,
      status,
      evidenceResourceKeys: evidence,
      reasonCodes: status === 'matched' ? ['actual-run-read']
        : status === 'omitted' ? ['catalog-match-never-read'] : ['actual-read-below-minimum'],
    }
  })
  const requiredFailure = plan.requirements.some(requirement => requirement.level === 'stable-required'
    && requirementOutcomes.find(item => item.requirementKey === requirement.key)?.status !== 'matched')
  if (requiredFailure) fail('required-source-evidence', '正式发布缺少稳定必读世界资源的真实 run 读取证据')
  const statuses: WorldRequirementStatusV1[] = ['matched', 'missing', 'conflict', 'omitted', 'insufficient']
  const summary = Object.fromEntries(statuses.map(status => [
    status,
    requirementOutcomes.filter(item => item.status === status).length,
  ])) as ProductSourceManifestV1['summary']
  const base: Omit<ProductSourceManifestV1, 'manifestHash'> = {
    schema: 'storyforge.product-source-manifest', version: 1,
    productType: plan.productType,
    productInstanceKey: plan.productInstanceKey,
    worldReferenceHash: plan.worldReference.referenceHash,
    sourcePlanHash: plan.planHash,
    runContextManifests: pointers.map(({ runId: _localRunId, ...pointer }) => pointer)
      .sort((left, right) => left.manifestHash.localeCompare(right.manifestHash)
        || left.stepId.localeCompare(right.stepId) || left.attempt - right.attempt),
    requirementOutcomes,
    resources,
    summary,
    createdAt: input.createdAt ?? Date.now(),
  }
  return { ...base, manifestHash: await hashCanonicalValue(base) }
}

export async function validateProductSourceManifestV1(input: {
  sourceManifest: ProductSourceManifestV1
  sourcePlan: ProductSourcePlanV1
}): Promise<ProductSourceManifestV1> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  const manifest = input.sourceManifest
  if (manifest.schema !== 'storyforge.product-source-manifest' || manifest.version !== 1
    || manifest.productType !== plan.productType || manifest.productInstanceKey !== plan.productInstanceKey
    || manifest.worldReferenceHash !== plan.worldReference.referenceHash
    || manifest.sourcePlanHash !== plan.planHash) {
    fail('source-manifest-contract', 'ProductSourceManifest 与 SourcePlan owner/hash 链不一致')
  }
  assertHash(manifest.manifestHash, 'sourceManifest.manifestHash')
  const { manifestHash, ...body } = manifest
  if (await hashCanonicalValue(body) !== manifestHash) fail('source-manifest-hash', 'ProductSourceManifest hash 不匹配')
  const pointerKeys = new Set<string>()
  for (const pointer of manifest.runContextManifests) {
    const key = `${pointer.manifestHash}:${pointer.stepId}:${pointer.attempt}`
    if (!pointer.stepId.trim() || !Number.isSafeInteger(pointer.attempt) || pointer.attempt < 1
      || pointerKeys.has(key)) fail('source-manifest-pointer', 'ProductSourceManifest evidence pointer 非法或重复')
    pointerKeys.add(key)
    assertHash(pointer.manifestHash, 'sourceManifest.pointer.manifestHash')
  }
  return structuredClone(manifest)
}

export function productReleaseUidV1(input: {
  productType: UpperProductKindV1
  productInstanceKey: string
  releaseVersion: number
  releaseHash: string
}): string {
  assertStableKey(input.productInstanceKey, 'productInstanceKey')
  assertHash(input.releaseHash, 'releaseHash')
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 1) fail('release-version', 'releaseVersion 非法')
  return `PR-${encodeURIComponent(input.productType)}-${encodeURIComponent(input.productInstanceKey)}-v${input.releaseVersion}-${input.releaseHash.slice(0, 24)}`
}

export async function createProductReleaseLineageV1(input: {
  productType: UpperProductKindV1
  productInstanceKey: string
  releaseUid: string
  releaseVersion: number
  releaseHash: string
  parentRelease: ProductReleaseLineageV1['parentRelease']
  worldReference: WorldReferenceV1
  sourcePlan: ProductSourcePlanV1
  sourceManifest: ProductSourceManifestV1
  confirmedBrief: ConfirmedProductBriefV1
  build: ProductReleaseLineageV1['build']
  quality: ProductReleaseLineageV1['quality']
  compatibility: ProductReleaseLineageV1['compatibility']
  createdAt?: number
}): Promise<ProductReleaseLineageV1> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  await validateConfirmedProductBriefV1({ brief: input.confirmedBrief, sourcePlan: plan })
  await validateProductSourceManifestV1({ sourceManifest: input.sourceManifest, sourcePlan: plan })
  if (input.sourceManifest.sourcePlanHash !== plan.planHash
    || input.sourceManifest.worldReferenceHash !== plan.worldReference.referenceHash
    || input.sourceManifest.productType !== input.productType
    || input.sourceManifest.productInstanceKey !== input.productInstanceKey
    || input.confirmedBrief.productType !== input.productType
    || input.confirmedBrief.productInstanceKey !== input.productInstanceKey) {
    fail('lineage-chain', 'ProductRelease lineage 上游 owner/hash 链不一致')
  }
  for (const hash of [input.releaseHash, input.sourceManifest.manifestHash,
    input.build.buildHash, ...input.quality.receiptHashes, ...input.compatibility.evidenceHashes]) assertHash(hash, 'lineage hash')
  if (!input.quality.passed) fail('quality', '质量门未通过不能冻结 ProductRelease lineage')
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 1
    || !Number.isSafeInteger(input.compatibility.protocolVersion) || input.compatibility.protocolVersion < 1) {
    fail('lineage-version', 'release/compatibility version 非法')
  }
  if ((input.releaseVersion === 1) !== (input.parentRelease == null)) {
    fail('lineage-parent', '首版不得有 parent，后续版必须声明 parent')
  }
  if (input.parentRelease) {
    assertHash(input.parentRelease.releaseHash, 'parent.releaseHash')
    if (input.compatibility.status === 'initial') fail('lineage-compatibility', '有父版本时 compatibility 不能是 initial')
  } else if (input.compatibility.status !== 'initial') {
    fail('lineage-compatibility', '首版 compatibility 必须是 initial')
  }
  const base: Omit<ProductReleaseLineageV1, 'lineageHash'> = {
    schema: 'storyforge.product-release-lineage', version: 1,
    productType: input.productType,
    productInstanceKey: input.productInstanceKey,
    releaseUid: input.releaseUid,
    releaseVersion: input.releaseVersion,
    releaseHash: input.releaseHash,
    parentRelease: input.parentRelease,
    worldReferenceHash: input.worldReference.referenceHash,
    sourcePlanHash: plan.planHash,
    sourceManifestHash: input.sourceManifest.manifestHash,
    confirmedBriefHash: input.confirmedBrief.confirmationHash,
    build: { ...input.build },
    quality: { passed: true, receiptHashes: uniqueSorted(input.quality.receiptHashes) },
    compatibility: {
      ...input.compatibility,
      evidenceHashes: uniqueSorted(input.compatibility.evidenceHashes),
    },
    createdAt: input.createdAt ?? Date.now(),
  }
  return { ...base, lineageHash: await hashCanonicalValue(base) }
}

/** Runtime stage gate: only an immutable ProductRelease lineage can start. */
export async function validateProductReleaseLineageV1(value: ProductReleaseLineageV1): Promise<ProductReleaseLineageV1> {
  if (value.schema !== 'storyforge.product-release-lineage' || value.version !== 1) fail('lineage-contract', 'ProductReleaseLineage 合同无效')
  const { lineageHash, ...body } = value
  assertHash(lineageHash, 'lineageHash')
  if (await hashCanonicalValue(body) !== lineageHash || !value.quality.passed) fail('lineage-hash', 'ProductReleaseLineage hash/质量门无效')
  return structuredClone(value)
}

export async function assertFormalProductProductionStartV1(input: {
  sourcePlan: ProductSourcePlanV1
  confirmedBrief: ConfirmedProductBriefV1
  authorStartRevision: number
}): Promise<void> {
  const plan = await validateProductSourcePlanV1(input.sourcePlan)
  const brief = await validateConfirmedProductBriefV1({ brief: input.confirmedBrief, sourcePlan: plan })
  if (plan.readiness === 'blocked') fail('source-plan-blocked', 'SourcePlan 存在未解决的稳定必读缺口')
  if (brief.authorStartRevision !== input.authorStartRevision) {
    fail('start-stale', '用户开始授权 revision 已变化，必须重新确认 Brief/SourcePlan')
  }
}
