import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCultivationStore } from '../../src/stores/cultivation'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { preparePowerAuthoringCopilotV1, parsePowerAuthoringRequestV1, parsePowerAuthoringCandidateV1, adoptRestoredPowerAuthoringCandidateV1, type PowerAuthoringRequestV1 } from '../../src/lib/agent/power-authoring-copilot'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { parseMasterAgentPlanV1, restoreMasterAgentCandidatesV1, runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { powerRemovalImpactHashV1 } from '../../src/lib/cultivation/power-authoring-adoption'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture() {
  const f = await seedCurrentWorkspace('048 定点生成测试')
  const stages = JSON.stringify([{ id: 'root', name: '起境', parentStageIds: [], features: '原能力 α', authorExtra: { exact: 125 } },
    { id: 'left', name: '左境', parentStageIds: ['root'] }, { id: 'right', name: '右境', parentStageIds: ['root'] }, { id: 'join', name: '合流', parentStageIds: ['left', 'right'] }])
  const id = await useCultivationStore.getState().addSystem({ projectId: f.scope.projectId, name: '原独立路径', description: '作者原原理', stages }, f.scope)
  const request: PowerAuthoringRequestV1 = { target: { table: 'cultivationSystems', recordId: id, field: 'stages', stageId: 'root', stageField: 'features' }, allocatedStageIds: [] }
  return { ...f, id, stages, request }
}
async function runMaster(f: Awaited<ReturnType<typeof fixture>>, raw = JSON.stringify({ version: 1, value: '新能力\r\n精确尾空格  ' }), request = f.request) {
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '只修改选中力量字段。', pinnedTask: {
    agentId: 'world-origin', skillId: 'world-origin.power-authoring', instruction: '只修改选中的力量字段，保留其他阶段和原理。', powerAuthoringRequest: request,
  } })
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'test-power048' })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body))
    expect(sent.messages.map((m: { content: string }) => m.content).join('\n')).toContain('原能力 α')
    return new Response(JSON.stringify({ choices: [{ message: { content: raw } }], usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const result = await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan, budget: new AgentTeamBudgetTracker('balanced') })
  return { ...result, fetch, plan }
}
it('freezes a closed exact target and refuses other Skills carrying the request', async () => {
  const f = await fixture()
  expect(parsePowerAuthoringRequestV1(f.request)).toEqual(f.request)
  for (const invalid of [{ ...f.request, scope: f.scope }, { ...f.request, allocatedStageIds: ['forbidden'] },
    { ...f.request, target: { ...f.request.target, stageField: 'ownerId' } }, { ...f.request, target: { ...f.request.target, recordId: 0 } }]) expect(() => parsePowerAuthoringRequestV1(invalid)).toThrow()
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '定点力量生成', pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.power-authoring', instruction: '定点生成', powerAuthoringRequest: f.request } })
  expect(parseMasterAgentPlanV1(plan).tasks[0].powerAuthoringRequest).toEqual(f.request)
  expect(() => parseMasterAgentPlanV1({ ...plan, tasks: [{ ...plan.tasks[0], skillId: 'world-origin.worldview-field' }] })).toThrow('powerAuthoringRequest')
  expect(() => parseMasterAgentPlanV1({ ...plan, tasks: [{ ...plan.tasks[0], powerAuthoringRequest: undefined }] })).toThrow()
})
it('reads the actual original record through Canon Gateway and creates only an independent editable candidate', async () => {
  const f = await fixture(), runAI = vi.fn(async () => JSON.stringify({ version: 1, value: '  完整新能力\r\n尾空白  ' }))
  const prepared = await preparePowerAuthoringCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: f.request, authorRequest: '增加能力限制' }, { runAI })
  expect(prepared.contextSources).toContain('ragSelection')
  expect(prepared.prepared.messages.map(m => m.content).join('\n')).toContain('原能力 α')
  expect(prepared.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'cultivationSystems' && ref.recordId === f.id && ref.field === 'stages')).toBe(true)
  const result = await runGenerationNode(prepared.node, prepared.prepared)
  expect(result.adopted).toBe(false); expect((await db.cultivationSystems.get(f.id))!.stages).toBe(f.stages)
  await adoptRestoredPowerAuthoringCandidateV1({ scope: f.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: JSON.stringify(result.output) })
  const after = (await db.cultivationSystems.get(f.id))!
  expect(JSON.parse(after.stages)[0]).toEqual({ ...JSON.parse(f.stages)[0], features: '  完整新能力\r\n尾空白  ' })
  expect(JSON.parse(after.stages).slice(1)).toEqual(JSON.parse(f.stages).slice(1)); expect(after.description).toBe('作者原原理')
  expect(runAI).toHaveBeenCalledTimes(1)
})
it('rejects bad old graphs before dispatch and stale/foreign work or mutated baselines before adoption', async () => {
  const f = await fixture(), runAI = vi.fn(async () => '{"version":1,"value":"候选"}')
  await db.cultivationSystems.update(f.id, { stages: '[{"id":"a","name":"环","parentStageIds":["a"]}]' })
  await expect(preparePowerAuthoringCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: f.request, authorRequest: '测试' }, { runAI })).rejects.toThrow()
  expect(runAI).not.toHaveBeenCalled()
  await db.cultivationSystems.update(f.id, { stages: f.stages })
  const prepared = await preparePowerAuthoringCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: f.request, authorRequest: '测试' }, { runAI })
  const other = await seedCurrentWorkspace('外部作品')
  await expect(adoptRestoredPowerAuthoringCandidateV1({ scope: other.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: '{"version":1,"value":"候选"}' })).rejects.toThrow('不属于')
  await db.cultivationSystems.update(f.id, { description: '作者后来修改' })
  await expect(prepared.runRaw(prepared.prepared.messages)).rejects.toThrow('已变化')
  await expect(adoptRestoredPowerAuthoringCandidateV1({ scope: f.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: '{"version":1,"value":"候选"}' })).rejects.toThrow('已变化')
  expect(runAI).not.toHaveBeenCalled()
})
it('freezes preallocated IDs, rejects model deletion confirmation and requires current author impact confirmation', async () => {
  const f = await fixture(), request: PowerAuthoringRequestV1 = { target: { table: 'cultivationSystems', recordId: f.id, field: 'stages' }, allocatedStageIds: ['host-new'] }
  const prepared = await preparePowerAuthoringCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request, authorRequest: '重排阶段' })
  const candidate = { version: 1 as const, value: { version: 1, updates: [], additions: [{ id: 'host-new', name: '新合流', parentStageIds: ['left', 'right'] }], removals: ['join'] } }
  expect(() => parsePowerAuthoringCandidateV1(JSON.stringify({ ...candidate, confirmedRemovalHash: 'a'.repeat(64) }), prepared.snapshot, false)).toThrow('未登记字段')
  expect(() => parsePowerAuthoringCandidateV1(JSON.stringify({ ...candidate, value: { ...candidate.value, additions: [{ id: 'model-made', name: '伪造', parentStageIds: [] }] } }), prepared.snapshot)).toThrow('preallocated')
  await expect(adoptRestoredPowerAuthoringCandidateV1({ scope: f.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: JSON.stringify(candidate) })).rejects.toThrow('确认')
  const confirmedRemovalHash = await powerRemovalImpactHashV1(prepared.snapshot.baseline, ['join'])
  await adoptRestoredPowerAuthoringCandidateV1({ scope: f.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: JSON.stringify({ ...candidate, confirmedRemovalHash }) })
  expect(JSON.parse((await db.cultivationSystems.get(f.id))!.stages).map((s: { id: string }) => s.id)).toEqual(['root', 'left', 'right', 'host-new'])
})
it('restores the same durable candidate without another model call, atomically rolls back a failed Run receipt, then retries exact adoption', async () => {
  const f = await fixture(), before = (await db.cultivationSystems.get(f.id))!, run = await runMaster(f)
  expect(run.candidates).toHaveLength(1); expect(run.fetch).toHaveBeenCalledTimes(1)
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: run.runId })
  expect(restored.candidates).toHaveLength(1)
  const candidate = restored.candidates[0], ref = { scope: f.scope, worldGroupId: null, runId: run.runId, candidateEventId: candidate.event.id! }
  const contract = (await readAgentRunV1(f.scope, run.runId)).contract
  expect(contract.permissions.writeTargets).toEqual([{ table: 'cultivationSystems', fields: ['stages'], mode: 'author-confirmed' }])
  await expect(commitMasterAgentCandidateAdoptionV1(ref, { afterBusinessAdoption: async () => { throw new Error('receipt disk fault') } })).rejects.toThrow('receipt disk fault')
  expect(await db.cultivationSystems.get(f.id)).toEqual(before)
  expect((await readAgentRunV1(f.scope, run.runId)).events.some(event => event.type === 'adoption.committed')).toBe(false)
  const originalAdd = db.agentRunEvents.add
  const fault = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(function (this: typeof db.agentRunEvents, event, key) {
    if (event.type === 'step.succeeded') return Promise.reject(new Error('final journal quota fault')) as ReturnType<typeof originalAdd>
    return originalAdd.call(this, event, key)
  })
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('final journal quota fault')
  fault.mockRestore()
  expect(await db.cultivationSystems.get(f.id)).toEqual(before)
  expect((await readAgentRunV1(f.scope, run.runId)).events.some(event => event.type === 'adoption.committed')).toBe(false)
  await commitMasterAgentCandidateAdoptionV1(ref)
  expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: run.runId })).accepted).toBe(true)
  expect(JSON.parse((await db.cultivationSystems.get(f.id))!.stages)[0].features).toBe('新能力\r\n精确尾空格  ')
  expect(run.fetch).toHaveBeenCalledTimes(1)
})
it('preserves an invalid author draft for correction and rejection without writing the original field or generating again', async () => {
  const f = await fixture(), run = await runMaster(f), candidate = run.candidates[0]
  await updateAgentEventCandidate(candidate.event.id!, f.scope.projectId, '{"version":1,"value":', f.scope)
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: run.runId })
  expect(restored.candidates[0].draft).toBe('{"version":1,"value":')
  await expect(commitMasterAgentCandidateAdoptionV1({ scope: f.scope, worldGroupId: null, runId: run.runId, candidateEventId: candidate.event.id! })).rejects.toThrow()
  expect((await db.cultivationSystems.get(f.id))!.stages).toBe(f.stages)
  await updateAgentEventCandidate(candidate.event.id!, f.scope.projectId, JSON.stringify({ version: 1, value: '作者修正稿' }), f.scope)
  await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, worldGroupId: null, runId: run.runId, candidateEventId: candidate.event.id! })
  expect(JSON.parse((await db.cultivationSystems.get(f.id))!.stages)[0].features).toBe('作者修正稿')
  expect(run.fetch).toHaveBeenCalledTimes(1)
})
