import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../agent/execution-binding'
import { runReadOnlyAgent, type AgentModelAdapter, type ReadOnlyAgentResult } from '../agent/runner'
import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import type { AgentToolResult } from '../agent/types'
import { hashCanonicalValue } from '../agent/run/hash'
import { CONTEXT_SOURCES } from '../registry/context-sources'
import type {
  ContextPacketV1,
  ContextAccessPolicyV1,
  ContextResourceDescriptorV1,
  ContextSufficiencyObligationV1,
  ContextSufficiencyReportV1,
  ContextTimeRangeV1,
  FrozenResourceScopeV1,
  RetrievalDecisionV1,
  RetrievalQueryTraceV1,
  RetrievalTraceV1,
} from '../registry/types'
import type { WorkspaceScope } from '../types'
import {
  createContextGatewayContractSnapshotV1,
  createContextPacketV1,
  createContextSufficiencyReportV1,
  createRetrievalTraceV1,
  filterContextResourcePageV1,
  assertResourcePageV1,
} from './contracts'
import {
  inspectContextGatewayManifestFreshnessV1,
  verifyContextGatewayCandidateEvidenceV1,
  type ContextGatewaySourceSnapshotInputV1,
  type ContextGatewayToolTranscriptInputV1,
} from './attempt-evidence'
import {
  CONTEXT_SELECTOR_VERSION_V1,
  contextSelectorCategoryForKindV1,
  selectContextResourcesV1,
  type ContextSelectorResultV1,
} from './selector'
import {
  createContextGatewayToolSessionV1,
  settleContextGatewayTokensV1,
  type ContextGatewayProviderBindingV1,
  type ContextGatewayToolSessionV1,
} from './tool-session'
import {
  assertAgentSkillContextGatewayPolicyV1,
  contextGatewayAdditionalReadToolNamesForSkillV1,
  createContextAccessPolicyForExecutionV1,
  isContextGatewayRequiredForWriteTargetV1,
} from './skill-policy'

const CATALOG_PAGE_SIZE = 50
const MAX_CATALOG_PAGES = 20_000

export type ContextGatewayExecutionPathV1 =
  | 'deterministic-fast'
  | 'bounded-additional-read'
  | 'deterministic-fallback'

export interface ExecuteContextGatewayInputV1 {
  skill: AgentSkillDefinitionV1
  scope: WorkspaceScope
  worldGroupId?: number | null
  chapterId?: number | null
  characterId?: number | null
  query?: string
  budgetTokens?: number
  mandatoryResourceKeys?: readonly string[]
  /** Mandatory whole-resource reads; supports aggregate resources with multiple source refs. */
  mandatoryFullResourceKeys?: readonly string[]
  /**
   * Mandatory target resources whose exact source value must be delivered.
   * This is a deterministic escalation for known edit targets, not an Agent
   * search shortcut; every key must also be declared mandatory.
   */
  mandatoryOriginalResourceKeys?: readonly string[]
  targetResourceKeys?: readonly string[]
  entityKeys?: readonly string[]
  storyArcKeys?: readonly string[]
  timeRange?: ContextTimeRangeV1
  /** Runtime narrowing only; callers cannot add kinds not declared by the Skill. */
  excludedResourceKinds?: readonly ContextResourceDescriptorV1['kind'][]
  /** Cross-product production may read an immutable WorldRelease instead of
   * the mutable current Work scope. The locator must still belong to scope. */
  resourceScope?: FrozenResourceScopeV1
  /** Adapter-frozen policy; validated as a narrowing of the Skill grant. */
  accessPolicyOverride?: ContextAccessPolicyV1
  /** Exact resource permission derived from ProductSourcePlan selectors. */
  allowedResourceKeys?: readonly string[]
  /** Omit to disable extra planning calls while preserving deterministic selection. */
  additionalReadModel?: AgentModelAdapter
  additionalReadsEnabled?: boolean
  signal?: AbortSignal
}

export interface ContextGatewayExecutionV1 {
  version: 'context-gateway-execution-v1'
  path: ContextGatewayExecutionPathV1
  session: ContextGatewayToolSessionV1
  selector: ContextSelectorResultV1
  sufficiency: ContextSufficiencyReportV1
  retrievalTrace: RetrievalTraceV1
  contextPacket: ContextPacketV1
  sourceSnapshots: ContextGatewaySourceSnapshotInputV1[]
  toolTranscript: ContextGatewayToolTranscriptInputV1[]
  metrics: {
    catalogPages: number
    catalogResources: number
    deterministicResourceReads: number
    additionalPlanningModelCalls: number
    additionalToolCalls: number
    additionalReadResources: number
    retrievedTokens: number
    stopReason: string
  }
}

export class ContextGatewayExecutionErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[context-gateway-execution:${code}] ${message}`)
    this.name = 'ContextGatewayExecutionErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new ContextGatewayExecutionErrorV1(code, message)
}

function frozenScope(input: ExecuteContextGatewayInputV1): FrozenResourceScopeV1 {
  if (input.resourceScope) {
    if (input.resourceScope.projectId !== input.scope.projectId
      || (input.resourceScope.worldId != null && input.resourceScope.worldId !== input.scope.worldId)
      || (input.resourceScope.workId != null && input.resourceScope.workId !== input.scope.workId)) {
      fail('resource-scope', '冻结资源 scope 不属于当前 WorkspaceScope')
    }
    return { ...input.resourceScope }
  }
  return {
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: input.worldGroupId ?? null,
    ...(input.chapterId == null ? {} : { chapterId: input.chapterId }),
    ...(input.characterId === undefined ? {} : { characterId: input.characterId }),
  }
}

function narrowedAccessPolicy(input: ExecuteContextGatewayInputV1): ContextAccessPolicyV1 {
  const declared = createContextAccessPolicyForExecutionV1(input.skill, input.excludedResourceKinds)
  const override = input.accessPolicyOverride
  if (!override) return declared
  const subset = <T>(values: readonly T[], allowed: readonly T[]) => values.every(value => allowed.includes(value))
  if (!subset(override.allowedSourceKeys, declared.allowedSourceKeys)
    || !subset(override.mandatorySourceKeys, override.allowedSourceKeys)
    || !subset(override.allowedResourceKinds, declared.allowedResourceKinds)
    || !subset(override.allowedDepths, declared.allowedDepths)
    || override.selectorPolicyId !== declared.selectorPolicyId
    || override.maxReadCalls > declared.maxReadCalls
    || override.maxRetrievedTokens > declared.maxRetrievedTokens
    || (override.allowOriginalRead && !declared.allowOriginalRead)
    || override.candidateAccess !== 'forbidden') {
    fail('policy-override', 'SourcePlan policy 超出 Agent Skill 的静态权限')
  }
  return structuredClone(override)
}

function hardFailure(report: ContextSufficiencyReportV1): ContextSufficiencyObligationV1 | undefined {
  return report.obligations.find(item => item.required && (item.status === 'missing' || item.status === 'conflicted'))
}

async function collectCatalog(session: ContextGatewayToolSessionV1): Promise<{
  descriptors: ContextResourceDescriptorV1[]
  pages: number
}> {
  const descriptors: ContextResourceDescriptorV1[] = []
  const keys = new Set<string>()
  let pages = 0
  for (const binding of session.providers) {
    const kinds = session.policy.allowedResourceKinds.filter(kind => binding.provider.kinds.includes(kind))
    if (!kinds.length) continue
    let cursor: string | undefined
    do {
      if (++pages > MAX_CATALOG_PAGES) fail('catalog-page-budget', `目录超过 ${MAX_CATALOG_PAGES} 页，拒绝静默截断`)
      const raw = await binding.provider.listMetadata({
        scope: session.scope,
        kinds,
        limit: CATALOG_PAGE_SIZE,
        cursor,
      })
      const page = filterContextResourcePageV1({
        page: assertResourcePageV1({
          page: raw,
          source: binding.source,
          expectedScopeFingerprint: session.scopeFingerprint,
          maxItems: CATALOG_PAGE_SIZE,
        }),
        policy: session.policy,
      })
      for (const descriptor of page.items) {
        if (keys.has(descriptor.resourceKey)) fail('duplicate-resource', `目录重复 ${descriptor.resourceKey}`)
        keys.add(descriptor.resourceKey)
        descriptors.push(descriptor)
      }
      cursor = raw.nextCursor ?? undefined
    } while (cursor)
  }
  return {
    descriptors: descriptors.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    pages,
  }
}

function bindingFor(
  session: ContextGatewayToolSessionV1,
  sourceKey: string,
): ContextGatewayProviderBindingV1 {
  return session.providers.find(item => item.source.key === sourceKey)
    ?? fail('provider-missing', `资源来源 ${sourceKey} 不在冻结 Gateway session`)
}

function retrievalDecision(input: {
  decision: ContextSelectorResultV1['selected'][number]
  descriptor: ContextResourceDescriptorV1
  tokenCount: number
}): RetrievalDecisionV1 {
  return {
    resourceKey: input.decision.resourceKey,
    sourceKey: input.decision.sourceKey,
    reason: input.decision.reasonCodes.join('+'),
    depth: input.decision.depth,
    revision: input.decision.contentRevision,
    contentHash: input.decision.contentHash,
    policyRevision: input.decision.policyRevision,
    policyHash: input.decision.policyHash,
    sourceRefs: [...input.descriptor.sourceRefs],
    tokenCount: input.tokenCount,
  }
}

function timeBoundary(descriptor: ContextResourceDescriptorV1): number | string | null {
  return descriptor.timeRange?.start
    ?? descriptor.timeRange?.end
    ?? descriptor.scope.chapterId
    ?? null
}

function compareBoundary(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
}

async function reconcileSufficiency(input: {
  selector: ContextSelectorResultV1
  descriptors: readonly ContextResourceDescriptorV1[]
  agentReads: readonly RetrievalDecisionV1[]
  readsAllowed: boolean
  assumptions?: readonly string[]
}): Promise<ContextSufficiencyReportV1> {
  const readKeys = new Set(input.agentReads.map(item => item.resourceKey))
  const descriptorByKey = new Map(input.descriptors.map(item => [item.resourceKey, item]))
  const additionalTokensByCategory = new Map<string, number>()
  for (const read of input.agentReads) {
    const descriptor = descriptorByKey.get(read.resourceKey)
    if (!descriptor) continue
    const category = contextSelectorCategoryForKindV1(descriptor.kind)
    additionalTokensByCategory.set(category, (additionalTokensByCategory.get(category) ?? 0) + read.tokenCount)
  }
  const temporal = input.descriptors
    .filter(item => timeBoundary(item) != null)
    .sort((left, right) => compareBoundary(timeBoundary(left)!, timeBoundary(right)!))
  const earliestKey = temporal[0]?.resourceKey
  const obligations = input.selector.sufficiency.obligations.map(obligation => {
    if (obligation.required || obligation.status !== 'missing') return obligation
    if (obligation.id.startsWith('category-quota:')) {
      const category = obligation.id.slice('category-quota:'.length)
      const budget = input.selector.categoryBudgets.find(item => item.category === category)
      const delivered = (budget?.selectedTokens ?? 0) + (additionalTokensByCategory.get(category) ?? 0)
      if (budget && delivered >= budget.targetTokens) {
        const evidence = input.agentReads
          .filter(read => contextSelectorCategoryForKindV1(descriptorByKey.get(read.resourceKey)!.kind) === category)
          .map(read => read.resourceKey)
        return {
          ...obligation,
          status: 'satisfied' as const,
          evidenceResourceKeys: [...new Set([...obligation.evidenceResourceKeys, ...evidence])].sort(),
          reasonCode: 'category-quota-delivered-with-agent-read',
        }
      }
    }
    if (obligation.id === 'early-anchor' && earliestKey && readKeys.has(earliestKey)) {
      return {
        ...obligation,
        status: 'satisfied' as const,
        evidenceResourceKeys: [earliestKey],
        reasonCode: 'early-anchor-delivered-with-agent-read',
      }
    }
    return obligation
  })
  return createContextSufficiencyReportV1({
    obligations,
    assumptions: [...input.selector.sufficiency.assumptions, ...(input.assumptions ?? [])],
    readsAllowed: input.readsAllowed,
  })
}

async function selectorWithSufficiency(
  selector: ContextSelectorResultV1,
  sufficiency: ContextSufficiencyReportV1,
): Promise<ContextSelectorResultV1> {
  const { selectorHash: _hash, ...body } = selector
  const next = { ...body, sufficiency }
  return { ...next, selectorHash: await hashCanonicalValue(next) }
}

function parseAgentRead(
  result: AgentToolResult,
  descriptors: ReadonlyMap<string, ContextResourceDescriptorV1>,
): { decision?: RetrievalDecisionV1; content?: string } {
  if (!result.ok || !result.meta.gateway) return {}
  const resourceKey = result.meta.gateway.resourceKeys[0]
  if (!resourceKey) return {}
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result.content) as Record<string, unknown>
  } catch {
    fail('tool-result-json', `${result.meta.toolName} 返回非法 JSON`)
  }
  if (result.meta.gateway.operation === 'original') {
    return { content: typeof parsed.content === 'string' ? parsed.content : undefined }
  }
  if (result.meta.gateway.operation !== 'read') return {}
  const descriptor = descriptors.get(resourceKey)
  if (!descriptor || !parsed.descriptor || typeof parsed.content !== 'string') {
    fail('tool-result-resource', `工具结果 ${resourceKey} 与冻结目录不一致`)
  }
  const publicDescriptor = parsed.descriptor as Record<string, unknown>
  if (publicDescriptor.contentHash !== descriptor.contentHash
    || publicDescriptor.policyHash !== descriptor.policyHash) {
    fail('tool-result-descriptor', `工具结果 ${resourceKey} 的 descriptor 已漂移`)
  }
  return {
    decision: {
      resourceKey,
      sourceKey: descriptor.sourceKey,
      reason: 'agent-additional-read',
      depth: parsed.depth as RetrievalDecisionV1['depth'],
      revision: descriptor.contentRevision,
      contentHash: descriptor.contentHash,
      policyRevision: descriptor.policyRevision,
      policyHash: descriptor.policyHash,
      sourceRefs: result.meta.gateway.sourceRefEvidence.map(item => item.sourceRef),
      tokenCount: estimateTokens(parsed.content),
    },
    content: parsed.content,
  }
}

async function validatedAgentRead(
  result: AgentToolResult,
  descriptors: ReadonlyMap<string, ContextResourceDescriptorV1>,
): Promise<{ decision?: RetrievalDecisionV1; content?: string }> {
  const parsed = parseAgentRead(result, descriptors)
  if (!parsed.content || result.meta.gateway?.operation !== 'read') return parsed
  const wire = JSON.parse(result.content) as Record<string, unknown>
  if (wire.contentHash !== await sha256Text(parsed.content)) fail('tool-result-hash', '追加读取正文 hash 不匹配')
  return parsed
}

export async function executeContextGatewayV1(
  input: ExecuteContextGatewayInputV1,
): Promise<ContextGatewayExecutionV1> {
  const gatewayPolicy = assertAgentSkillContextGatewayPolicyV1(input.skill)
  const accessPolicy = narrowedAccessPolicy(input)
  const session = await createContextGatewayToolSessionV1({
    scope: frozenScope(input),
    policy: accessPolicy,
    allowedResourceKeys: input.allowedResourceKeys,
  })
  const catalog = await collectCatalog(session)
  const readsAllowed = input.additionalReadsEnabled !== false
    && input.additionalReadModel != null
    && gatewayPolicy.additionalReadToolNames.length > 0
  let selector = await selectContextResourcesV1({
    taskKind: input.skill.contextTaskKind,
    accessPolicy: session.policy,
    scope: session.scope,
    descriptors: catalog.descriptors,
    budgetTokens: Math.min(input.budgetTokens ?? session.policy.maxRetrievedTokens, session.policy.maxRetrievedTokens),
    mandatoryResourceKeys: input.mandatoryResourceKeys,
    mandatoryFullResourceKeys: input.mandatoryFullResourceKeys,
    mandatoryOriginalResourceKeys: input.mandatoryOriginalResourceKeys,
    targetResourceKeys: input.targetResourceKeys,
    entityKeys: input.entityKeys,
    storyArcKeys: input.storyArcKeys,
    timeRange: input.timeRange,
    query: input.query,
    readsAllowed,
  })
  const initialHardFailure = hardFailure(selector.sufficiency)
  if (initialHardFailure) {
    fail('hard-sufficiency', `${initialHardFailure.id}:${initialHardFailure.reasonCode}`)
  }

  const mandatoryInputKeys = new Set(input.mandatoryResourceKeys ?? [])
  const mandatoryOriginalKeys = new Set(input.mandatoryOriginalResourceKeys ?? [])
  for (const key of mandatoryOriginalKeys) {
    if (!mandatoryInputKeys.has(key)) {
      fail('original-not-mandatory', `原文定点读取必须同时声明 mandatory resource: ${key}`)
    }
    if (!session.policy.allowOriginalRead || !session.policy.allowedDepths.includes('original')) {
      fail('original-forbidden', `Skill 不允许原文定点读取: ${key}`)
    }
  }

  const descriptorByKey = new Map(catalog.descriptors.map(item => [item.resourceKey, item]))
  const deterministicReads: RetrievalDecisionV1[] = []
  const sourceSnapshots: ContextGatewaySourceSnapshotInputV1[] = []
  const packetBlocks: string[] = []
  const deterministicDecisions = [...selector.selected].sort((left, right) => (
    Number(mandatoryOriginalKeys.has(right.resourceKey))
    - Number(mandatoryOriginalKeys.has(left.resourceKey))
    || left.resourceKey.localeCompare(right.resourceKey)
  ))
  for (const decision of deterministicDecisions) {
    const descriptor = descriptorByKey.get(decision.resourceKey)
      ?? fail('selector-resource', `选择结果缺少目录资源 ${decision.resourceKey}`)
    const remaining = session.policy.maxRetrievedTokens - session.usage.retrievedTokens
    if (remaining < 1) fail('deterministic-token-budget', `确定性读取 ${decision.resourceKey} 前额度耗尽`)
    const binding = bindingFor(session, decision.sourceKey)
    if (mandatoryOriginalKeys.has(decision.resourceKey)) {
      if (descriptor.sourceRefs.length !== 1) {
        fail('mandatory-original-ambiguous', `原文定点读取要求唯一 source ref: ${decision.resourceKey}`)
      }
      const sourceRef = descriptor.sourceRefs[0]!
      const read = await binding.provider.readOriginal({
        scope: session.scope,
        resourceKey: decision.resourceKey,
        sourceRef,
        maxTokens: remaining,
      })
      const exactHash = sourceRef.anchor?.quoteHash ?? sourceRef.contentHash
      if (descriptor.contentHash !== decision.contentHash
        || descriptor.policyHash !== decision.policyHash
        || read.descriptor.contentHash !== decision.contentHash
        || read.descriptor.policyHash !== decision.policyHash
        || read.contentHash !== exactHash
        || read.contentHash !== await sha256Text(read.content)
        || read.tokenCount !== estimateTokens(read.content)) {
        fail('mandatory-original-incomplete', `${decision.resourceKey} 原文超出本轮预算或验签失败，拒绝静默截断`)
      }
      settleContextGatewayTokensV1(session, read.tokenCount)
      deterministicReads.push({
        ...retrievalDecision({ decision, descriptor: read.descriptor, tokenCount: read.tokenCount }),
        depth: 'original',
        sourceRefs: [sourceRef],
      })
      sourceSnapshots.push({
        sourceKey: decision.sourceKey,
        resourceKey: decision.resourceKey,
        sourceRefs: [sourceRef],
        content: read.content,
      })
      packetBlocks.push(`【${read.descriptor.kind}｜${read.descriptor.title}｜original】\n${read.content}`)
      continue
    }
    if (decision.depth === 'original') {
      fail('original-not-declared', `selector 返回了未声明的原文读取: ${decision.resourceKey}`)
    }
    const read = await binding.provider.read({
      scope: session.scope,
      resourceKey: decision.resourceKey,
      depth: decision.depth,
      maxTokens: Math.max(1, Math.min(remaining, decision.estimatedTokens || remaining)),
    })
    if (descriptor.contentHash !== decision.contentHash
      || descriptor.policyHash !== decision.policyHash
      || read.descriptor.contentHash !== decision.contentHash
      || read.descriptor.policyHash !== decision.policyHash
      || read.contentHash !== await sha256Text(read.content)
      || read.tokenCount !== estimateTokens(read.content)) {
      fail('deterministic-read-integrity', `${decision.resourceKey} 在选择后发生漂移或正文验签失败`)
    }
    settleContextGatewayTokensV1(session, read.tokenCount)
    deterministicReads.push(retrievalDecision({ decision, descriptor: read.descriptor, tokenCount: read.tokenCount }))
    sourceSnapshots.push({
      sourceKey: decision.sourceKey,
      resourceKey: decision.resourceKey,
      sourceRefs: read.descriptor.sourceRefs,
      content: read.content,
    })
    packetBlocks.push(`【${read.descriptor.kind}｜${read.descriptor.title}｜${decision.depth}】\n${read.content}`)
  }

  const agentReads = new Map<string, RetrievalDecisionV1>()
  const deterministicReadKeys = new Set(deterministicReads.map(item => item.resourceKey))
  const toolTranscript: ContextGatewayToolTranscriptInputV1[] = []
  const queryTrace: RetrievalQueryTraceV1[] = []
  let planning: ReadOnlyAgentResult | null = null
  let path: ContextGatewayExecutionPathV1 = 'deterministic-fast'
  let stopReason = 'sufficient-with-deterministic-selection'
  let liveSufficiency = selector.sufficiency
  let callIndex = 0

  if (selector.sufficiency.additionalRead === 'needed' && readsAllowed) {
    path = 'bounded-additional-read'
    planning = await runReadOnlyAgent({
      goal: [
        '为同一个创作 Skill 补齐上下文证据。不要创作正文；充分后立即 final。',
        `任务=${input.skill.id}`,
        `查询=${input.query?.trim() || '（无）'}`,
        `已选资源=${selector.selected.map(item => item.resourceKey).join(',') || '（无）'}`,
        `缺失义务=${selector.sufficiency.obligations.filter(item => item.status === 'missing').map(item => item.id).join(',')}`,
      ].join('\n'),
      context: {
        projectId: input.scope.projectId,
        scope: input.scope,
        worldGroupId: input.worldGroupId ?? null,
        contextGatewaySession: session,
      },
      model: input.additionalReadModel!,
      allowedToolNames: contextGatewayAdditionalReadToolNamesForSkillV1(input.skill),
      limits: {
        maxSteps: gatewayPolicy.maxPlanningSteps,
        maxToolCalls: gatewayPolicy.maxReadCalls,
        maxTotalTokens: gatewayPolicy.maxPlanningModelTokens,
        maxToolResultTokens: gatewayPolicy.maxRetrievedTokens,
        maxProtocolErrors: 1,
      },
      signal: input.signal,
      stopAfterToolBatch: async batch => {
        let evidenceCalls = 0
        let added = 0
        for (const item of batch.results) {
          const resourceKey = item.result.meta.gateway?.resourceKeys[0]
          toolTranscript.push({
            toolName: item.name,
            callIndex: callIndex++,
            ...(resourceKey ? { resourceKey } : {}),
            arguments: item.arguments,
            result: item.result,
          })
          if (item.result.meta.gateway?.operation === 'search' || item.result.meta.gateway?.operation === 'list') {
            queryTrace.push({
              query: item.name === 'search_context'
                ? String(item.arguments.query ?? '')
                : '[catalog]',
              sourceKeys: [...item.result.meta.sourceKeys].sort(),
              resultResourceKeys: [...item.result.meta.gateway.resourceKeys],
              resultFingerprint: await hashCanonicalValue({
                tool: item.name,
                arguments: item.arguments,
                resourceKeys: item.result.meta.gateway.resourceKeys,
              }),
            })
          }
          if (item.result.meta.gateway?.operation === 'read') {
            evidenceCalls++
            const parsed = await validatedAgentRead(item.result, descriptorByKey)
            if (parsed.decision
              && !deterministicReadKeys.has(parsed.decision.resourceKey)
              && !agentReads.has(parsed.decision.resourceKey)) {
              agentReads.set(parsed.decision.resourceKey, parsed.decision)
              packetBlocks.push(`【追加读取｜${parsed.decision.resourceKey}｜${parsed.decision.depth}】\n${parsed.content ?? ''}`)
              added++
            }
          } else if (item.result.meta.gateway?.operation === 'original' && item.result.ok) {
            packetBlocks.push(`【原文回查｜${resourceKey ?? 'unknown'}】\n${(await validatedAgentRead(item.result, descriptorByKey)).content ?? ''}`)
          }
        }
        liveSufficiency = await reconcileSufficiency({
          selector,
          descriptors: catalog.descriptors,
          agentReads: [...agentReads.values()],
          readsAllowed: true,
        })
        if (liveSufficiency.additionalRead === 'not-needed') return 'context-sufficient'
        if (evidenceCalls > 0 && added === 0) return 'context-read-no-new-evidence'
        return null
      },
    })
    stopReason = planning.status
    liveSufficiency = await reconcileSufficiency({
      selector,
      descriptors: catalog.descriptors,
      agentReads: [...agentReads.values()],
      readsAllowed: false,
      ...(liveSufficiency.additionalRead === 'needed'
        ? { assumptions: [`additional-read-stopped:${planning.status}`] }
        : {}),
    })
  } else if (selector.sufficiency.additionalRead !== 'not-needed') {
    path = 'deterministic-fallback'
    stopReason = readsAllowed ? 'additional-read-not-needed-state-invalid' : 'additional-reads-disabled'
    liveSufficiency = await reconcileSufficiency({
      selector,
      descriptors: catalog.descriptors,
      agentReads: [],
      readsAllowed: false,
      assumptions: ['additional-reads-disabled'],
    })
  }
  if (hardFailure(liveSufficiency)) fail('hard-sufficiency-after-read', '追加读取后仍有硬缺失或冲突')
  selector = await selectorWithSufficiency(selector, liveSufficiency)

  const mandatoryKeys = new Set(selector.selected.filter(item => item.hardRequirement).map(item => item.resourceKey))
  const retrievalTrace = await createRetrievalTraceV1({
    catalogVersion: selector.inventoryHash,
    selectorPolicyId: selector.selectorPolicyId,
    mandatory: deterministicReads.filter(item => mandatoryKeys.has(item.resourceKey)),
    autoSelected: deterministicReads.filter(item => !mandatoryKeys.has(item.resourceKey)),
    agentReads: [...agentReads.values()].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    omitted: selector.omitted.map(item => ({
      resourceKey: item.resourceKey,
      sourceKey: item.sourceKey,
      reasonCode: item.reasonCode,
      tokenEstimate: item.estimatedTokens,
    })),
    queries: queryTrace,
    fallbackUsed: path === 'deterministic-fallback',
  })
  const providerSources = CONTEXT_SOURCES.filter(source => accessPolicy.allowedSourceKeys.includes(source.key))
  const contract = await createContextGatewayContractSnapshotV1({
    policy: session.policy,
    sources: providerSources,
    gatewayVersion: 'context-gateway-execution-v1',
    selectorVersion: CONTEXT_SELECTOR_VERSION_V1,
    sufficiencyObligationsVersion: 'context-sufficiency-v1',
    toolSchemaHash: AGENT_TOOL_SCHEMA_HASH_V1,
    normalizationVersion: 'context-gateway-execution-v1',
  })
  const content = packetBlocks.join('\n\n')
  const contextPacket = await createContextPacketV1({
    scopeFingerprint: session.scopeFingerprint,
    gatewayVersionHash: contract.gateway.versionHash,
    policyHash: session.policyHash,
    sufficiencyReportHash: liveSufficiency.reportHash,
    retrievalTraceHash: retrievalTrace.traceHash,
    content,
    sourceRefs: [...deterministicReads, ...agentReads.values()].flatMap(item => item.sourceRefs),
  })
  return {
    version: 'context-gateway-execution-v1',
    path,
    session,
    selector,
    sufficiency: liveSufficiency,
    retrievalTrace,
    contextPacket,
    sourceSnapshots,
    toolTranscript,
    metrics: {
      catalogPages: catalog.pages,
      catalogResources: catalog.descriptors.length,
      deterministicResourceReads: deterministicReads.length,
      additionalPlanningModelCalls: planning?.steps ?? 0,
      additionalToolCalls: planning?.toolCalls ?? 0,
      additionalReadResources: agentReads.size,
      retrievedTokens: session.usage.retrievedTokens,
      stopReason,
    },
  }
}

export async function assertContextGatewayCandidateAdoptableV1(input: {
  skill: AgentSkillDefinitionV1
  writeTarget?: string
  scope: WorkspaceScope
  worldGroupId?: number | null
  chapterId?: number | null
  characterId?: number | null
  runId: number
  stepId: string
  attempt: number
  candidateHash: string
  contextManifestHash?: string
  excludedResourceKinds?: readonly ContextResourceDescriptorV1['kind'][]
}): Promise<{ mode: 'legacy-or-shadow' } | { mode: 'required'; manifestHash: string; freshnessHash: string }> {
  if (!isContextGatewayRequiredForWriteTargetV1(input.skill, input.writeTarget)) {
    return { mode: 'legacy-or-shadow' }
  }
  if (!input.contextManifestHash) fail('candidate-manifest-required', `Skill ${input.skill.id} 的候选缺少 ContextManifestV3`)
  const verified = await verifyContextGatewayCandidateEvidenceV1({
    scope: input.scope,
    runId: input.runId,
    stepId: input.stepId,
    attempt: input.attempt,
    candidateHash: input.candidateHash,
  })
  if (verified.manifest.manifestHash !== input.contextManifestHash) {
    fail('candidate-manifest-mismatch', '候选声明的 Context Manifest 与 exact evidence 不一致')
  }
  const session = await createContextGatewayToolSessionV1({
    scope: {
      projectId: input.scope.projectId,
      worldId: input.scope.worldId,
      workId: input.scope.workId,
      worldGroupId: input.worldGroupId ?? null,
      ...(input.chapterId == null ? {} : { chapterId: input.chapterId }),
      ...(input.characterId === undefined ? {} : { characterId: input.characterId }),
    },
    policy: createContextAccessPolicyForExecutionV1(input.skill, input.excludedResourceKinds),
  })
  const freshness = await inspectContextGatewayManifestFreshnessV1({ manifest: verified.manifest, session })
  if (freshness.status !== 'fresh') fail('candidate-context-stale', freshness.reasonCodes.join(','))
  return {
    mode: 'required',
    manifestHash: verified.manifest.manifestHash,
    freshnessHash: freshness.reportHash,
  }
}
