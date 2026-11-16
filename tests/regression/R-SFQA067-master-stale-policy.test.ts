import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { formatStoryCoreGenerationRequestV1 } from '../../src/lib/agent/story-core-copilot'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { beginAgentRunRecoveryV1, readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { findResumableMasterAgentRunV1, runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { recoverPendingMasterAgentAdoptionsV1 } from '../../src/lib/agent/run/master-adoption'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config: { provider: 'openai', model: 'sfqa067-synthetic',
    baseUrl: 'https://sfqa067.invalid/v1', apiKey: 'fixture-only', temperature: 0,
    maxTokens: 4_096, contextWindow: 32_768 }, presets: [], taskRoutes: {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

it.each(['mount', 'half-recovery'] as const)('067 uses the real frozen stale policy after %s and needs a fresh author run before another call', async recoveryPath => {
  const { scope } = await seedCurrentWorkspace('067 隔离主 Agent 来源')
  const now = Date.now()
  const worldId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId: scope.projectId, worldOrigin: '旧来源：镜海退潮，记忆凝成盐晶。',
    factionLayout: '盐晶由拾忆行会保管。', createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never)
  const original = '守灯人追查一枚无主盐晶。'
  const coreId = await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId: scope.projectId, logline: original, concept: '记忆可以继承。', theme: '记忆与责任',
    centralConflict: '保存父亲的记忆，还是公开镜税的真相。', plotPattern: '线性调查',
    mainPlot: '守灯人追查盐晶来源。', subPlots: '行会内部争夺继承权。', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never)
  const conversation = await getOrCreateAgentConversation({
    projectId: scope.projectId, scope, worldGroupId: null, purpose: 'story-core-generation',
  })
  const plan: MasterAgentPlan = { summary: '生成一句话故事候选。', tasks: [{
    id: 'story-core-1', agentId: 'world-origin', skillId: 'world-origin.story-core',
    instruction: formatStoryCoreGenerationRequestV1({ field: 'logline', mode: 'expand', hint: '强化主角的代价' }),
    dependsOn: [],
  }], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } }
  const output = JSON.stringify({ field: 'logline', value: '守灯人为救父亲的记忆追查无主盐晶，却发现镜城靠遗忘维持秩序。' })
  const updated = '新来源：作者确认潮声才是记忆的唯一来源。'
  let allowFreshAuthorRun = false
  const requestBodies: string[] = []
  const fetch = vi.fn(async (_resource: RequestInfo | URL, init?: RequestInit) => {
    requestBodies.push(String(init?.body))
    if (requestBodies.length === 1) await db.worldviews.update(worldId, { worldOrigin: updated, updatedAt: now + 1 })
    else if (!allowFreshAuthorRun) throw new Error('isolated fixture caught an unauthorized replanning request')
    return new Response(JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 23, total_tokens: 54 } }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  const input = { scope, worldGroupId: null, conversationId: conversation.id!, plan }
  await expect(runDurableMasterAgentPlanV1({ ...input, budget: new AgentTeamBudgetTracker('balanced'),
    onDurableBoundary: boundary => { if (boundary.type === 'checkpoint.created') throw new Error('isolated older interruption') },
  })).rejects.toThrow('isolated older interruption')
  const earlierRunId = await findResumableMasterAgentRunV1({ scope, conversationId: conversation.id! })
  expect(earlierRunId).not.toBeNull()
  expect(fetch).not.toHaveBeenCalled()

  await expect(runDurableMasterAgentPlanV1({ ...input, budget: new AgentTeamBudgetTracker('balanced') }))
    .rejects.toThrow(/来源已变化.*等待作者/)
  // No mocked stale error, execute function or replan dependency: the real
  // frozen content revision sees the author edit after the first response.
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(requestBodies[0]).toContain('旧来源')
  const runId = (await db.agentRuns.where('projectId').equals(scope.projectId).last())!.id!
  expect(runId).not.toBe(earlierRunId)
  const snapshot = await readAgentRunV1(scope, runId)
  expect(snapshot.contract.failurePolicy.onStaleInput).toBe('pause-for-author')
  expect(snapshot.projection.state).toBe('paused')
  expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'step.failed',
    payload: expect.objectContaining({ category: 'stale-input', action: 'pause-for-author', retryable: false }) }))
  expect(snapshot.events.some(event => event.type === 'plan.replanned')).toBe(false)
  // Team limits use their frozen input/output estimate. Provider billing is
  // separate exact evidence; neither may invent a second model call.
  const charges = snapshot.events.filter(event => event.type === 'budget.settled')
  expect(charges).toHaveLength(1)
  expect(charges[0].payload.modelCalls).toBe(1)
  expect(charges[0].payload.tokens).toBeGreaterThan(0)
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  expect(checkpoint?.resumePayload).toMatchObject({ budgetEvidence: { calls: 1, usedTokens: charges[0].payload.tokens } })
  expect((await db.storyCores.get(coreId))?.logline).toBe(original)
  expect((await db.worldviews.get(worldId))?.worldOrigin).toBe(updated)

  db.close(); await db.open()
  const beforeRecovery = recoveryPath === 'half-recovery'
    ? (await beginAgentRunRecoveryV1({ scope, runId, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    : snapshot
  if (recoveryPath === 'mount') {
    expect(await recoverPendingMasterAgentAdoptionsV1(scope)).toEqual({ recoveredRunIds: [], failed: [] })
    expect(await readAgentRunV1(scope, runId)).toEqual(snapshot)
  } else {
    expect(beforeRecovery.projection.state).toBe('recovering')
  }
  expect(await findResumableMasterAgentRunV1({ scope, conversationId: conversation.id! })).toBeNull()
  await expect(runDurableMasterAgentPlanV1({ scope, worldGroupId: null, runId }))
    .rejects.toThrow(/来源已变化.*等待作者/)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await readAgentRunV1(scope, runId)).toEqual(beforeRecovery)

  allowFreshAuthorRun = true
  const fresh = await runDurableMasterAgentPlanV1({ ...input, budget: new AgentTeamBudgetTracker('balanced') })
  expect(fresh.runId).not.toBe(runId)
  expect(fresh.projection.state).toBe('awaiting_confirmation')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(requestBodies[1]).toContain(updated)
  expect((await db.storyCores.get(coreId))?.logline).toBe(original)
})

it('067 keeps exact provider evidence on the registered outline details route even when its source changes', async () => {
  const { scope } = await seedCurrentWorkspace('067 细纲原响应保留')
  const now = Date.now()
  const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, worldGroupId: null, parentId: null, type: 'chapter', title: '潮门',
    summary: '守灯人抵达潮门，必须在涨潮前找出灯塔失火的真相。', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  const conversation = await getOrCreateAgentConversation({ projectId: scope.projectId, scope, worldGroupId: null, purpose: 'master-authoring' })
  const output = `\r\n ${JSON.stringify({ openingHook: '潮声从门缝涌来。', endingCliffhanger: '灯芯映出第二道影子。',
    sceneLocation: '潮门内港', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], prohibitions: [],
    scenes: [{ title: '潮门回响', summary: '守灯人发现刻痕移动，决定拦住最后一班船。', location: '潮门内港',
      conflict: '时间紧迫与未知警告。', pace: 'fast', characterIds: [], estimatedWords: 1200 }] })}\n\t`
  const updated = '作者新摘要：潮门已开放，改走山路。'
  const fetch = vi.fn(async () => {
    await db.outlineNodes.update(outlineId, { summary: updated, updatedAt: now + 1 })
    return new Response(JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 23, total_tokens: 54 } }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  await expect(runDurableMasterAgentPlanV1({ scope, worldGroupId: null, conversationId: conversation.id!,
    plan: { summary: '完善《潮门》的场景细纲', tasks: [{ id: 'outline-detail-1', agentId: 'outline',
      skillId: 'outline.details', instruction: '完善《潮门》的场景细纲', dependsOn: [] }],
    workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } },
  })).rejects.toThrow(/来源已变化.*等待作者/)
  expect(fetch).toHaveBeenCalledTimes(1)
  const runId = (await db.agentRuns.where('projectId').equals(scope.projectId).last())!.id!
  const snapshot = await readAgentRunV1(scope, runId)
  expect(snapshot.projection.state).toBe('paused')
  expect(snapshot.events.some(event => event.type === 'plan.replanned' || event.type === 'candidate.persisted')).toBe(false)
  const raw = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'raw-response')
  if (raw?.type !== 'evidence.artifact.recorded') throw new Error('未保存原细纲响应证据')
  expect(raw.payload).toMatchObject({ stepId: 'master:outline-detail-1', attempt: 1 })
  const readRaw = () => readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response',
    contentHash: raw.payload.contentHash })
  const body = await readRaw()
  expect(JSON.parse(body)).toMatchObject({ version: 'creation-model-response-v1', raw: output,
    observation: { usage: { inputTokens: 31, outputTokens: 23, totalTokens: 54 } } })
  expect(await db.detailedOutlines.count()).toBe(0)
  expect((await db.outlineNodes.get(outlineId))?.summary).toBe(updated)
  db.close(); await db.open()
  await expect(runDurableMasterAgentPlanV1({ scope, worldGroupId: null, runId })).rejects.toThrow(/来源已变化.*等待作者/)
  expect(await readRaw()).toBe(body)
  expect(fetch).toHaveBeenCalledTimes(1)
})
