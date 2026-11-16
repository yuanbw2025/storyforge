import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from './current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from './current-resource-identity'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1, findResumableMasterAgentRunV1 } from '../../src/lib/agent/run/master-durable'
import { beginMasterAgentCandidateAdoptionV1, recoverPendingMasterAgentAdoptionsV1 } from '../../src/lib/agent/run/master-adoption'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { WorkspaceScope } from '../../src/lib/types'

const workflow = { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } as const
function configureModel() {
  useAIConfigStore.setState({ config: { provider: 'openai', model: 'sfqa064067-synthetic',
    baseUrl: 'https://sfqa064067.invalid/v1', apiKey: 'fixture-only', temperature: 0,
    maxTokens: 4096, contextWindow: 32768 }, presets: [], taskRoutes: {} })
}

/** Real preparation/Gateway/run/author intent. Only model text is synthetic,
 * through the existing executor dependency; no application method is mocked. */
export async function prepareReceiptRollback() {
  configureModel()
  const created = await seedCurrentWorkspace('064 原生事务恢复', { enableMultiWorld: true })
  const scope = created.scope, now = Date.now()
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId: scope.projectId, name: '主世界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' })) as number
  await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'volume', title: '第一卷', summary: '潮门即将关闭。',
    worldGroupId, order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  const prepared = await prepareOutlineCopilot({ projectId: scope.projectId, scope, worldGroupId,
    authorRequest: '展开第一卷章节大纲' })
  const contentRevision = await captureWorkspaceContentRevisionV1({ scope, worldGroupId })
  const items = [{ title: '潮门关闭', summary: '城门在潮汐前关闭，守灯人被迫留下。' },
    { title: '最后一班船', summary: '守灯人发现仍有一艘船没有返航。' }]
  const conversation = await getOrCreateAgentConversation({ projectId: scope.projectId, scope,
    worldGroupId, purpose: 'master-authoring' })
  const result = await runDurableMasterAgentPlanV1({ scope, worldGroupId, conversationId: conversation.id,
    plan: { summary: '生成第一卷章节大纲。', tasks: [{ id: 'outline-1', agentId: 'outline', skillId: 'outline.compose',
      instruction: '生成两个章节。', dependsOn: [] }], workflow: { ...workflow, reasonCodes: [...workflow.reasonCodes] } },
    budget: new AgentTeamBudgetTracker('balanced'),
  }, { execute: async options => {
    const task = options.plan.tasks[0], trace = options.executionTrace, budget = options.budget
    if (!trace?.taskStarted || !trace.contextGatewayPrepared || !trace.candidateReady || !budget || !task.skillId) throw Error('Missing real durable trace/budget/skill')
    await trace.taskStarted(task)
    const reservation = budget.reserveCall({ label: task.id, messages: [{role: 'user', content: task.instruction}], maxOutputTokens: 100 })
    const draft = JSON.stringify(items)
    budget.settleCall(reservation, draft)
    const renderedRequest = [{ role: 'user' as const, content: task.instruction }]
    const execution = prepared.contextGatewayExecution, assembled = prepared.input.assembled
    await trace.contextGatewayPrepared(task, { execution, assembled, renderedRequest })
    await trace.candidateReady(task, { payload: { version: 1, taskId: task.id, agentId: task.agentId, skillId: task.skillId,
      label: '章节大纲', contextSources: prepared.contextSources, contextEvidence: prepared.contextEvidence,
      baseSnapshot: prepared.snapshot, contentRevision, outlineMode: prepared.mode,
      outlineParentId: prepared.parentVolumeId, workspaceScope: scope, dependsOnTaskIds: [],
    }, draft, runtimeNode: prepared.node, runtimeOutput: draft,
    contextGatewayRuntime: { execution, assembled, renderedRequest, rawResponse: draft } })
    return []
  } })
  const runId = result.runId, candidate = result.candidates[0]
  await beginMasterAgentCandidateAdoptionV1({ scope, runId, candidateEventId: candidate.event.id!, worldGroupId })
  const before = await readAgentRunV1(scope, runId), outline = await db.outlineNodes.where('projectId').equals(scope.projectId).toArray()
  let injected = 0
  const fault = (_key: unknown, row: {type: string}) => {
    if (row.type === 'step.succeeded') { injected++; throw Error('native064 final receipt fault') }
  }
  db.agentRunEvents.hook('creating', fault)
  let recovery: Awaited<ReturnType<typeof recoverPendingMasterAgentAdoptionsV1>>
  try { recovery = await recoverPendingMasterAgentAdoptionsV1(scope) }
  finally { db.agentRunEvents.hook('creating').unsubscribe(fault) }
  const after = await readAgentRunV1(scope, runId)
  return { scope, runId, items, recovery, injected, beforeEvents: before.events,
    rollbackEvents: after.events, beforeOutline: outline,
    rollbackOutline: await db.outlineNodes.where('projectId').equals(scope.projectId).toArray() }
}

export async function finishReceiptRollback(input: { scope: WorkspaceScope; runId: number }) {
  const recovery = await recoverPendingMasterAgentAdoptionsV1(input.scope)
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const original = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
  if (original?.type !== 'evidence.artifact.recorded') throw Error('Missing original exact response')
  return { recovery, state: snapshot.projection.state,
    committed: snapshot.events.filter(event => event.type === 'adoption.committed').length,
    succeeded: snapshot.events.filter(event => event.type === 'step.succeeded').length,
    chapters: (await db.outlineNodes.where('projectId').equals(input.scope.projectId).toArray())
      .filter(row => row.type === 'chapter').map(({title,summary}) => ({title,summary})),
    raw: await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: original.payload.contentHash }) }
}

export async function prepareStaleDetails() {
  configureModel()
  const { scope } = await seedCurrentWorkspace('067 原生来源暂停'), now = Date.now()
  const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, worldGroupId: null, parentId: null, type: 'chapter', title: '潮门',
    summary: '守灯人抵达潮门，必须在涨潮前找出灯塔失火的真相。', order: 0, createdAt: now, updatedAt: now,
  }, {owner: 'work'})) as number
  const conversation = await getOrCreateAgentConversation({ projectId: scope.projectId, scope, worldGroupId: null, purpose: 'master-authoring' })
  const output = `\r\n ${JSON.stringify({ openingHook: '潮声从门缝涌来。', endingCliffhanger: '灯芯映出第二道影子。',
    sceneLocation: '潮门内港', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], prohibitions: [],
    scenes: [{ title: '潮门回响', summary: '守灯人发现刻痕移动，决定拦住最后一班船。', location: '潮门内港',
      conflict: '时间紧迫与未知警告。', pace: 'fast', characterIds: [], estimatedWords: 1200 }] })}\n\t`
  return { scope, outlineId, now, conversationId: conversation.id!, output, updated: '作者新摘要：潮门已开放，改走山路。' }
}

export async function runStaleDetails(input: Awaited<ReturnType<typeof prepareStaleDetails>>) {
  configureModel()
  let failure = ''
  try { await runDurableMasterAgentPlanV1({ scope: input.scope, worldGroupId: null, conversationId: input.conversationId,
    plan: { summary: '完善《潮门》的场景细纲', tasks: [{id:'outline-detail-1',agentId:'outline',skillId:'outline.details',
      instruction:'完善《潮门》的场景细纲',dependsOn:[]}], workflow: {...workflow,reasonCodes:[...workflow.reasonCodes]} } }) }
  catch (error) { failure = String(error) }
  const row = await db.agentRuns.where('projectId').equals(input.scope.projectId).last()
  if (!row?.id) throw Error('Missing actual Run')
  return { failure, runId: row.id, ...await readStaleDetails({scope: input.scope, runId: row.id}) }
}

async function readStaleDetails(input: {scope: WorkspaceScope; runId: number}) {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const original = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
  if (original?.type !== 'evidence.artifact.recorded') throw Error('Missing original exact provider evidence')
  return {state:snapshot.projection.state, events:snapshot.events,
    raw:await readAgentRunArtifactExactV1({projectId:input.scope.projectId,artifactKind:'raw-response',contentHash:original.payload.contentHash}),
    candidates:snapshot.events.filter(event=>event.type==='candidate.persisted').length,
    replans:snapshot.events.filter(event=>event.type==='plan.replanned').length,
    details:await db.detailedOutlines.where('projectId').equals(input.scope.projectId).count()}
}

export async function resumeStaleDetails(input: {scope: WorkspaceScope; runId:number; conversationId:number}) {
  configureModel()
  const before=await readAgentRunV1(input.scope,input.runId)
  const mount=await recoverPendingMasterAgentAdoptionsV1(input.scope)
  const resumable=await findResumableMasterAgentRunV1({scope:input.scope,conversationId:input.conversationId})
  let failure=''
  try {await runDurableMasterAgentPlanV1({scope:input.scope,worldGroupId:null,runId:input.runId})}
  catch(error){failure=String(error)}
  return {failure,mount,resumable,eventsUnchanged:JSON.stringify(before.events)===JSON.stringify((await readAgentRunV1(input.scope,input.runId)).events),
    ...await readStaleDetails(input)}
}
