import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { getAgentSkillV1, type AgentSkillDefinitionV1 } from '../../src/lib/agent/skill-registry'
import { createAgentSkillExecutionBindingV2, assertAgentSkillExecutionBindingIntegrityV2 } from '../../src/lib/agent/execution-binding'
import { runReadOnlyAgent, type AgentModelAdapter } from '../../src/lib/agent/runner'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  createContextManifestV1,
  createContextManifestV2FromV1,
} from '../../src/lib/agent/run/context-manifest'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  assertContextGatewayCandidateAdoptableV1,
  executeContextGatewayV1,
} from '../../src/lib/context-gateway/execution'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
} from '../../src/lib/context-gateway/attempt-evidence'
import { createContextAccessPolicyFromSkillV1 } from '../../src/lib/context-gateway/skill-policy'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { selectContextResourcesV1, contextSelectorCategoryForKindV1 } from '../../src/lib/context-gateway/selector'
import type { ContextResourceDescriptorV1, WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const NOW = 1_787_800_000_000

async function seedWorkspace(name = 'CTXG-7 快慢路径') {
  const created = await seedCurrentWorkspace(name)
  return { projectId: created.scope.projectId, scope: created.scope }
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner?: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId, createdAt: NOW, updatedAt: NOW, ...row,
  }, owner ? { owner } : {})) as Promise<number>
}

function worldviewSkill(): AgentSkillDefinitionV1 {
  return getAgentSkillV1('world-origin.worldview-field')
}

async function descriptors(scope: WorkspaceScope): Promise<ContextResourceDescriptorV1[]> {
  const result: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: { ...scope, worldGroupId: null }, limit: 50, cursor,
    })
    result.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return result
}

function scriptedModel(actions: unknown[], calls: { count: number }): AgentModelAdapter {
  return {
    transport: 'text-json-v1',
    complete: async () => {
      const action = actions[calls.count++] ?? { type: 'final', answer: 'done' }
      return { content: JSON.stringify(action), action }
    },
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
})

describe('CTXG-7 · Gateway fast/complex execution', () => {
  it('empty project uses deterministic fast path with zero planning/tool/resource reads', async () => {
    const fixture = await seedWorkspace('空项目只保留低权重题名')
    const calls = { count: 0 }
    const result = await executeContextGatewayV1({
      skill: worldviewSkill(),
      scope: fixture.scope,
      worldGroupId: null,
      query: '生成种族与民族；题名只作轻量灵感',
      additionalReadModel: scriptedModel([{ type: 'final', answer: '不应调用' }], calls),
    })

    expect(result.path).toBe('deterministic-fast')
    expect(result.sufficiency.additionalRead).toBe('not-needed')
    expect(result.metrics).toMatchObject({
      catalogResources: 0,
      deterministicResourceReads: 0,
      additionalPlanningModelCalls: 0,
      additionalToolCalls: 0,
      additionalReadResources: 0,
    })
    expect(calls.count).toBe(0)
    expect(result.contextPacket.content).toBe('')
  })

  it('short project stays on one deterministic path and tools-disabled produces the same packet', async () => {
    const fixture = await seedWorkspace()
    await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: null,
      races: '潮民以月相记历，镜裔禁止直呼真名。',
      cultureOverview: '誓言由潮钟见证。',
    }, 'world')
    const calls = { count: 0 }
    const enabled = await executeContextGatewayV1({
      skill: worldviewSkill(), scope: fixture.scope, worldGroupId: null,
      query: '扩写种族与民族',
      additionalReadModel: scriptedModel([{ type: 'final', answer: '不应调用' }], calls),
    })
    const disabled = await executeContextGatewayV1({
      skill: worldviewSkill(), scope: fixture.scope, worldGroupId: null,
      query: '扩写种族与民族', additionalReadsEnabled: false,
    })

    expect(calls.count).toBe(0)
    expect(enabled.path).toBe('deterministic-fast')
    expect(disabled.path).toBe('deterministic-fast')
    expect(disabled.contextPacket.packetHash).toBe(enabled.contextPacket.packetHash)
    expect(enabled.metrics.deterministicResourceReads).toBeGreaterThan(0)
    expect(enabled.metrics.additionalToolCalls).toBe(0)
  })

  it('complex soft deficit enters the same Runner once and is bounded by the Skill allowlist/budgets', async () => {
    const fixture = await seedWorkspace()
    await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: null,
      worldOrigin: '群岛来自沉没大陆的脊骨。',
      races: '潮民、镜裔和盐翼族长期争夺航道。',
    }, 'world')
    await addScoped(fixture.scope, 'storyCores', {
      logline: '失忆领航员必须在潮门关闭前找回海图。',
      centralConflict: '个人记忆与族群存续冲突。',
    }, 'work')
    for (let index = 0; index < 8; index++) {
      await addScoped(fixture.scope, 'characters', {
        homeWorldGroupId: null,
        isCrossWorld: false,
        name: `航海者${index}`,
        roleWeight: index === 0 ? 'main' : 'supporting',
        shortDescription: `${'潮汐记忆与旧航路'.repeat(40)}-${index}`,
        identity: index % 2 ? '镜裔' : '潮民',
        goals: '守住不同族群共享的潮门。',
      }, 'world')
    }
    const skill = worldviewSkill()
    const policy = createContextAccessPolicyFromSkillV1(skill)
    const catalog = await descriptors(fixture.scope)
    let chosen: Awaited<ReturnType<typeof selectContextResourcesV1>> | null = null
    let budget = 0
    for (let candidateBudget = 100; candidateBudget <= 4_000; candidateBudget += 25) {
      try {
        const candidate = await selectContextResourcesV1({
          taskKind: skill.contextTaskKind,
          accessPolicy: policy,
          scope: { ...fixture.scope, worldGroupId: null },
          descriptors: catalog,
          budgetTokens: candidateBudget,
          query: '扩写潮民社会并处理角色冲突',
          readsAllowed: true,
        })
        const hard = candidate.sufficiency.obligations.some(item => item.required
          && (item.status === 'missing' || item.status === 'conflicted'))
        if (!hard && candidate.sufficiency.additionalRead === 'needed') {
          chosen = candidate
          budget = candidateBudget
          break
        }
      } catch {
        // Budgets below Mandatory Core are intentionally skipped.
      }
    }
    expect(chosen, 'fixture must expose a soft-only deficit').not.toBeNull()
    const missingCategory = chosen!.sufficiency.obligations
      .find(item => item.id.startsWith('category-quota:') && item.status === 'missing')
      ?.id.slice('category-quota:'.length)
    const selected = new Set(chosen!.selected.map(item => item.resourceKey))
    const target = catalog.find(item => !selected.has(item.resourceKey)
      && (!missingCategory || contextSelectorCategoryForKindV1(item.kind) === missingCategory))
      ?? catalog.find(item => !selected.has(item.resourceKey))!
    expect(target).toBeTruthy()

    const calls = { count: 0 }
    const result = await executeContextGatewayV1({
      skill, scope: fixture.scope, worldGroupId: null, budgetTokens: budget,
      query: '扩写潮民社会并处理角色冲突',
      additionalReadModel: scriptedModel([
        {
          type: 'tool',
          calls: [{
            name: 'read_context_resource',
            arguments: { resourceKey: target.resourceKey, depth: 'full', maxTokens: 4_000 },
          }],
        },
        { type: 'final', answer: '已完成有限读取' },
      ], calls),
    })

    expect(result.path).toBe('bounded-additional-read')
    expect(result.metrics.additionalPlanningModelCalls).toBeLessThanOrEqual(skill.contextGateway!.maxPlanningSteps)
    expect(result.metrics.additionalToolCalls).toBeLessThanOrEqual(skill.contextGateway!.maxReadCalls)
    expect(result.metrics.additionalToolCalls).toBe(1)
    expect(result.metrics.additionalReadResources).toBe(1)
    expect(result.retrievalTrace.agentReads.map(item => item.resourceKey)).toEqual([target.resourceKey])
    expect(result.toolTranscript).toHaveLength(1)
    expect(result.contextPacket.content).toContain(target.resourceKey)
  })

  it('hard missing stops before planning, and Runner rejects tools outside the frozen Skill capability', async () => {
    const fixture = await seedWorkspace()
    const calls = { count: 0 }
    await expect(executeContextGatewayV1({
      skill: worldviewSkill(), scope: fixture.scope, worldGroupId: null,
      mandatoryResourceKeys: ['worldview-field:does-not-exist:races'],
      additionalReadModel: scriptedModel([{ type: 'final', answer: '不应调用' }], calls),
    })).rejects.toThrow('hard-sufficiency')
    expect(calls.count).toBe(0)

    const protocolCalls = { count: 0 }
    const result = await runReadOnlyAgent({
      goal: '尝试越权',
      context: { projectId: fixture.projectId },
      allowedToolNames: ['list_context_catalog'],
      limits: { maxProtocolErrors: 0 },
      model: scriptedModel([{
        type: 'tool', calls: [{ name: 'read_work_status', arguments: {} }],
      }], protocolCalls),
    })
    expect(result.status).toBe('protocol_error')
    expect(result.toolCalls).toBe(0)
    expect(result.transcript[0].content).toContain('list_context_catalog')
    expect(result.transcript[0].content).not.toContain('read_work_status(')
  })

  it('known edit targets use exact Mandatory Original and fail closed instead of returning a prefix', async () => {
    const fixture = await seedWorkspace()
    const lateFact = '[TARGET-TAIL:七次退潮后才获得成年身份]'
    await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: null,
      races: `${'潮民的航季、亲族和盐路契约形成共同身份。'.repeat(120)}${lateFact}`,
    }, 'world')
    const catalog = await descriptors(fixture.scope)
    const target = catalog.find(item => item.sourceRefs.some(ref => (
      ref.table === 'worldviews' && ref.field === 'races'
    )))!

    const exact = await executeContextGatewayV1({
      skill: worldviewSkill(),
      scope: fixture.scope,
      worldGroupId: null,
      budgetTokens: 12_000,
      mandatoryResourceKeys: [target.resourceKey],
      mandatoryOriginalResourceKeys: [target.resourceKey],
      targetResourceKeys: [target.resourceKey],
      additionalReadsEnabled: false,
    })
    expect(exact.selector.selected.find(item => item.resourceKey === target.resourceKey)?.depth).toBe('original')
    expect(exact.retrievalTrace.mandatory.find(item => item.resourceKey === target.resourceKey)?.depth).toBe('original')
    expect(exact.contextPacket.content).toContain(lateFact)

    await expect(executeContextGatewayV1({
      skill: worldviewSkill(),
      scope: fixture.scope,
      worldGroupId: null,
      budgetTokens: 1_000,
      mandatoryResourceKeys: [target.resourceKey],
      mandatoryOriginalResourceKeys: [target.resourceKey],
      targetResourceKeys: [target.resourceKey],
      additionalReadsEnabled: false,
    })).rejects.toThrow('hard-sufficiency')
  })

  it('freezes the authoritative Gateway policy in Skill V2 and requires V3 evidence', async () => {
    const fixture = await seedWorkspace()
    const skill = worldviewSkill()
    const binding = await createAgentSkillExecutionBindingV2(skill)
    await expect(assertAgentSkillExecutionBindingIntegrityV2(binding)).resolves.toBeUndefined()
    expect(binding.skillDefinitionJson).toContain('contextGateway')
    const tampered = {
      ...binding,
      skillDefinitionJson: binding.skillDefinitionJson.replace('"maxReadCalls":4', '"maxReadCalls":40'),
    }
    await expect(assertAgentSkillExecutionBindingIntegrityV2(tampered)).rejects.toThrow('skillDefinitionHash')

    const registryContextSkill: AgentSkillDefinitionV1 = { ...skill, contextGateway: undefined }
    await expect(assertContextGatewayCandidateAdoptableV1({
      skill: registryContextSkill,
      scope: fixture.scope,
      worldGroupId: null,
      runId: 999,
      stepId: 'task:races',
      attempt: 1,
      candidateHash: 'a'.repeat(64),
    })).resolves.toEqual({ mode: 'registry-context' })

    const requiredSkill = skill
    await expect(assertContextGatewayCandidateAdoptableV1({
      skill: requiredSkill,
      scope: fixture.scope,
      worldGroupId: null,
      runId: 999,
      stepId: 'task:races',
      attempt: 1,
      candidateHash: 'a'.repeat(64),
    })).rejects.toThrow('candidate-manifest-required')
  })

  it('feeds the exact CTXG-7 output into V3 and blocks adoption after Canon becomes stale', async () => {
    const fixture = await seedWorkspace()
    const worldviewId = await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: null,
      races: '潮民必须在成年礼前记住七次退潮。',
    }, 'world')
    const skill: AgentSkillDefinitionV1 = {
      ...worldviewSkill(),
      contextGateway: { ...worldviewSkill().contextGateway!, rollout: 'required' },
    }
    const gateway = await executeContextGatewayV1({
      skill, scope: fixture.scope, worldGroupId: null, query: '扩写潮民成年礼',
      additionalReadsEnabled: false,
    })
    const contract = {
      version: 1 as const,
      objective: 'CTXG-7 V3 candidate',
      workflowKind: 'direct-generation',
      runtimeBindingHash: 'b'.repeat(64),
      scope: { projectId: fixture.projectId, worldGroupId: null },
      permissions: { contextSourceKeys: ['ragSelection'], writeTargets: [] },
      budget: {
        maxModelCalls: 1, maxToolCalls: 4, maxInputTokens: 24_000,
        maxOutputTokens: 2_000, maxAttemptsPerStep: 1,
      },
      acceptance: [{ id: 'candidate', kind: 'output-present', required: true }],
      verificationPlan: [{
        id: 'terminal', kind: 'terminal', verifier: 'ctxg7-v1', criterionIds: ['candidate'],
      }],
      failurePolicy: {
        onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
      },
    }
    let snapshot = await createAgentRunV1({ scope: fixture.scope, contract, now: NOW + 1 })
    const append = async (type: any, payload: any) => {
      snapshot = await appendAgentRunEventV1({
        scope: fixture.scope, runId: snapshot.run.id, type, payload,
        expectedLastSequence: snapshot.projection.lastSequence,
        now: NOW + snapshot.projection.lastSequence + 2,
      } as any)
    }
    await append('step.scheduled', { stepId: 'races' })
    await append('step.started', { stepId: 'races', attempt: 1 })
    const v1 = await createContextManifestV1({
      version: 1,
      runId: snapshot.run.id,
      stepId: 'races',
      attempt: 1,
      scope: { projectId: fixture.projectId, worldGroupId: null },
      inputBudget: 24_000,
      totalInputTokens: gateway.contextPacket.tokenCount,
      sources: [{
        key: 'ragSelection',
        status: 'included',
        contentHash: gateway.contextPacket.contentHash,
        tokens: gateway.contextPacket.tokenCount,
      }],
    })
    const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope: fixture.scope })
    const renderedRequest = {
      messages: [{ role: 'user', content: `扩写潮民成年礼\n${gateway.contextPacket.content}` }],
    }
    const preflight = await recordContextGatewayPreflightEvidenceV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      stepId: 'races',
      attempt: 1,
      contextPacket: gateway.contextPacket,
      selector: gateway.selector,
      renderedRequest,
      sourceSnapshots: gateway.sourceSnapshots,
      toolTranscript: gateway.toolTranscript,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = preflight.snapshot
    const candidateText = '潮民成年礼改为七次退潮的航海实证，并由镜裔见证。'
    const candidateHash = await sha256Text(candidateText)
    await append('model.requested', {
      stepId: 'races', attempt: 1, bindingHash: preflight.evidence.promptHash,
    })
    await append('model.responded', { stepId: 'races', attempt: 1, outputHash: candidateHash })
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      stepId: 'races',
      attempt: 1,
      baseManifest,
      preflight: preflight.evidence,
      selector: gateway.selector,
      sufficiency: gateway.sufficiency,
      retrievalTrace: gateway.retrievalTrace,
      gatewayVersionHash: gateway.contextPacket.gatewayVersionHash,
      policyHash: gateway.session.policyHash,
      rawResponse: { content: candidateText },
      candidateHash,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      type: 'candidate.persisted',
      payload: { stepId: 'races', attempt: 1, candidateHash, requiresConfirmation: true },
      expectedLastSequence: finalized.snapshot.projection.lastSequence,
    })

    const fresh = await assertContextGatewayCandidateAdoptableV1({
      skill,
      scope: fixture.scope,
      worldGroupId: null,
      runId: snapshot.run.id,
      stepId: 'races',
      attempt: 1,
      candidateHash,
      contextManifestHash: finalized.manifest.manifestHash,
    })
    expect(fresh.mode).toBe('required')

    await db.worldviews.update(worldviewId, {
      races: '作者已经把成年礼改为九次退潮。',
      updatedAt: NOW + 10_000,
    })
    await expect(assertContextGatewayCandidateAdoptableV1({
      skill,
      scope: fixture.scope,
      worldGroupId: null,
      runId: snapshot.run.id,
      stepId: 'races',
      attempt: 1,
      candidateHash,
      contextManifestHash: finalized.manifest.manifestHash,
    })).rejects.toThrow('candidate-context-stale')
  })
})
