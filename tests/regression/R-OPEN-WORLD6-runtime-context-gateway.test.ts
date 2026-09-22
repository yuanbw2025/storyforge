import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  verifyContextManifestIntegrityV2,
  verifyContextManifestIntegrityV3,
} from '../../src/lib/agent/run/context-manifest'
import { captureOpenWorldRuntimeHarnessBoundaryV1 } from '../../src/lib/agent/run/runtime-scope'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
} from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_V1,
  loadTextOpenWorldRuntimeContextCatalogV1,
} from '../../src/lib/open-world/runtime-ai-context-provider'
import {
  createTextOpenWorldRuntimeAIContextBaseManifestV2,
  prepareTextOpenWorldRuntimeAIContextV1,
} from '../../src/lib/open-world/runtime-ai-context'
import { createTextOpenWorldRuntimeAIRunContractV1 } from '../../src/lib/open-world/runtime-ai-contract'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import type { TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

const HIDDEN_SENTINEL = '上游闸门其实由未来章节的王室密探破坏。'

function runtimePackage(): TextOpenWorldRuntimePackageV1 {
  const value = createTextOpenWorldVNextP9Fixture()
  const narrative = value.modules.narrative.payload as any
  const knowledge = value.modules.knowledge.payload as any
  narrative.scenes.find((scene: any) => scene.key === 'scene.actor.caretaker')
    .allowedKnowledgeClaimKeys = ['knowledge.caretaker']
  knowledge.entries.push({
    key: 'knowledge.future-saboteur',
    kind: 'quest-clue',
    title: '尚未发生的王室阴谋',
    content: HIDDEN_SENTINEL,
    sourceRefs: ['world-release:future:saboteur'],
    initialPlayerVisibility: 'hidden',
    actorKeys: ['actor.caretaker'],
  })
  return value
}

async function fixture() {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `R-OPEN-WORLD6 运行上下文-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage(),
    runtimeShape: 'vnext-only',
    title: '盐脊运行上下文',
    seed: 'runtime-context-gateway-seed',
  })
}

async function boundaryFor(created: Awaited<ReturnType<typeof fixture>>) {
  return captureOpenWorldRuntimeHarnessBoundaryV1({
    scope: created.scope,
    productRuntimeSessionId: created.session.id!,
  })
}

describe('R-OPEN-WORLD6 · vNext 运行期 Context Gateway', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('分页穷尽精确Session目录，并从玩家可见投影中彻底排除隐藏知识', async () => {
    const created = await fixture()
    const boundary = await boundaryFor(created)
    const scope = {
      ...created.scope,
      worldGroupId: created.session.worldGroupId ?? null,
      productRuntimeSessionId: created.session.id!,
    }
    const catalog = await loadTextOpenWorldRuntimeContextCatalogV1(scope)
    expect(catalog).toMatchObject({
      sequence: boundary.scope.runtime.baseSequence,
      stateHash: boundary.scope.runtime.stateHash,
      visibilityHash: boundary.scope.runtime.visibilityHash,
      runtimeSourceHash: boundary.scope.runtime.releaseHash,
    })
    expect(catalog.resources.length).toBeGreaterThan(10)
    expect(JSON.stringify(catalog.resources)).not.toContain(HIDDEN_SENTINEL)
    expect(catalog.resources.every(resource => (
      resource.descriptor.scope.productRuntimeSessionId === created.session.id
      && resource.descriptor.sourceRefs.length > 0
    ))).toBe(true)

    const paged: string[] = []
    let cursor: string | undefined
    do {
      const page = await TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_V1.listMetadata({
        scope,
        kinds: [...TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_V1.kinds],
        limit: 3,
        cursor,
      })
      paged.push(...page.items.map(item => item.resourceKey))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(paged).toEqual(catalog.resources.map(item => item.descriptor.resourceKey))
    expect(new Set(paged).size).toBe(catalog.resources.length)

    await expect(loadTextOpenWorldRuntimeContextCatalogV1({
      ...scope,
      projectId: created.scope.projectId + 1,
    })).rejects.toThrow(/越过WorkspaceScope/)
    await expect(TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_V1.readOriginal!({
      scope,
      resourceKey: catalog.resources[0].descriptor.resourceKey,
      sourceRef: catalog.resources[0].descriptor.sourceRefs[0],
      maxTokens: 100,
    })).rejects.toThrow(/original读取/)
  }, 30_000)

  it('按Skill交付当前场景、合法Action和目标NPC知识，而不把模板或其他触发候选混入意图上下文', async () => {
    const created = await fixture()
    const boundary = await boundaryFor(created)
    const intent = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '理解玩家输入：我想先问问岑阿婆昨夜听见了什么。',
    })
    expect(intent.execution.contextPacket.content).toContain('干涸的内渠')
    expect(intent.execution.contextPacket.content).toContain('action.talk-caretaker')
    expect(intent.execution.contextPacket.content).not.toContain(HIDDEN_SENTINEL)
    expect(intent.selection.allowedResourceKeys.some(key => key.includes(':template:'))).toBe(false)
    expect(intent.selection.allowedResourceKeys.some(key => key.includes(':director-candidates:'))).toBe(false)
    expect(intent.selection.sliceCoverage.every(item => item.resourceKeys.length > 0)).toBe(true)
    expect(intent.execution.metrics.catalogResources).toBe(intent.selection.allowedResourceKeys.length)

    await expect(prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-dialogue',
      objective: '回应玩家',
    })).rejects.toThrow(/targetActorKey/)
    const dialogue = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-dialogue',
      objective: '让岑阿婆回答昨夜的异响，但不泄露未知真相。',
      targetActorKey: 'actor.caretaker',
    })
    expect(dialogue.execution.contextPacket.content).toContain('knowledge.caretaker')
    expect(dialogue.execution.contextPacket.content).not.toContain('knowledge.future-saboteur')
    expect(dialogue.selection.allowedResourceKeys.filter(key => key.includes(':actor:'))).toHaveLength(1)
    expect(dialogue.selection.allowedResourceKeys.filter(key => key.includes(':actor-knowledge:'))).toHaveLength(1)
  }, 30_000)

  it('终态演绎、任务包装与Director建议只读取调用方精确授权的结果或候选槽', async () => {
    const created = await fixture()
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.context.talk',
      requestedAt: 1_000,
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.rest',
      commandId: 'command.context.rest',
      requestedAt: 1_100,
    })
    const boundary = await boundaryFor(created)
    const expression = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-expression',
      objective: '演绎已经结算的谈话结果。',
      terminalCommandIds: ['command.context.talk'],
    })
    expect(expression.execution.contextPacket.content).toContain('command.context.talk')
    expect(expression.execution.contextPacket.content).not.toContain('command.context.rest')
    const terminalSnapshot = expression.execution.sourceSnapshots
      .find(item => item.resourceKey?.includes(':terminal-receipt:'))!
    expect(terminalSnapshot.sourceRefs?.every(ref => ref.table === 'productRuntimeEvents')).toBe(true)

    const packaging = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-quest-packaging',
      objective: '包装代码已经选择的地区小任务。',
      selectedTemplateKey: 'template.supplies',
    })
    expect(packaging.execution.contextPacket.content).toContain('template.supplies')
    expect(packaging.selection.allowedResourceKeys.filter(key => key.includes(':template:'))).toHaveLength(1)

    const direction = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-direction',
      objective: '在谈话触发下提出节奏建议。',
      directorTrigger: 'talk',
    })
    expect(direction.selection.allowedResourceKeys.filter(key => key.includes(':director-candidates:')))
      .toEqual([expect.stringContaining(':director-candidates:talk')])
    expect(direction.execution.contextPacket.content).not.toContain('director-candidates:arrival')
  }, 30_000)

  it('把精确资源、检索轨迹和最终请求固化为共享Manifest V3，并在Session推进后拒绝旧边界', async () => {
    const created = await fixture()
    const boundary = await boundaryFor(created)
    const preparation = await prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '映射玩家输入：接下盐渠委托。',
    })
    const contract = await createTextOpenWorldRuntimeAIRunContractV1({
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '映射玩家输入：接下盐渠委托。',
      scope: boundary.scope,
      runtimeBindingHash: boundary.boundaryHash,
    })
    const stepId = 'text-open-world-runtime-ai:intent'
    let snapshot = await createAgentRunV1({
      scope: created.scope,
      worldGroupId: created.session.worldGroupId ?? null,
      productRuntimeSessionId: created.session.id!,
      contract,
    })
    const append = async (type: any, payload: any) => {
      snapshot = await appendAgentRunEventV1({
        scope: created.scope,
        runId: snapshot.run.id,
        productRuntimeSessionId: created.session.id!,
        type,
        payload,
        expectedLastSequence: snapshot.projection.lastSequence,
      } as any)
    }
    await append('step.scheduled', { stepId })
    await append('step.started', { stepId, attempt: 1 })
    const baseManifest = await createTextOpenWorldRuntimeAIContextBaseManifestV2({
      preparation,
      scope: created.scope,
      runId: snapshot.run.id,
      stepId,
      attempt: 1,
    })
    expect(await verifyContextManifestIntegrityV2(baseManifest)).toBe(true)
    expect(baseManifest.sources[0].provenance.authority).toBe('runtime')
    const renderedRequest = {
      messages: [{ role: 'user', content: `接下盐渠委托。\n${preparation.execution.contextPacket.content}` }],
    }
    const preflight = await recordContextGatewayPreflightEvidenceV1({
      scope: created.scope,
      runId: snapshot.run.id,
      stepId,
      attempt: 1,
      contextPacket: preparation.execution.contextPacket,
      selector: preparation.execution.selector,
      renderedRequest,
      sourceSnapshots: preparation.execution.sourceSnapshots,
      toolTranscript: preparation.execution.toolTranscript,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = preflight.snapshot
    const rawResponse = { kind: 'mapped-action', confidence: 0.99, actionKey: 'action.accept-main' }
    const candidateHash = await sha256Text(JSON.stringify(rawResponse))
    await append('model.requested', { stepId, attempt: 1, bindingHash: preflight.evidence.promptHash })
    await append('model.responded', { stepId, attempt: 1, outputHash: candidateHash })
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({
      scope: created.scope,
      runId: snapshot.run.id,
      stepId,
      attempt: 1,
      baseManifest,
      preflight: preflight.evidence,
      selector: preparation.execution.selector,
      sufficiency: preparation.execution.sufficiency,
      retrievalTrace: preparation.execution.retrievalTrace,
      gatewayVersionHash: preparation.execution.contextPacket.gatewayVersionHash,
      policyHash: preparation.execution.session.policyHash,
      rawResponse,
      candidateHash,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    expect(await verifyContextManifestIntegrityV3(finalized.manifest)).toBe(true)
    expect(finalized.manifest.gateway.retrievalTrace.mandatory.length).toBeGreaterThan(0)
    expect(finalized.manifest.artifacts.some(item => item.role === 'rendered-request')).toBe(true)
    expect(finalized.manifest.artifacts.filter(item => item.role === 'source-snapshot').length)
      .toBe(preparation.execution.sourceSnapshots.length)
    const registeredTables = new Set(PROJECT_TABLES.map(table => table.name))
    expect(finalized.manifest.gateway.retrievalTrace.mandatory
      .flatMap(item => item.sourceRefs)
      .every(ref => registeredTables.has(ref.table as any))).toBe(true)

    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.accept-main',
      targetKey: 'quest-instance.12.quest.main.1.release.13.session-start',
      commandId: 'command.context.advance',
      requestedAt: 2_000,
    })
    await expect(prepareTextOpenWorldRuntimeAIContextV1({
      scope: created.scope,
      contractScope: boundary.scope,
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '尝试使用已经过期的输入边界。',
    })).rejects.toThrow(/边界与当前资源目录不一致/)
  }, 45_000)
})
