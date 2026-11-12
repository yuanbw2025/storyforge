import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adopt } from '../../src/lib/registry/adopt'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { getOrCreateAgentConversation,updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { beginMasterAgentCandidateAdoptionV1,commitMasterAgentCandidateAdoptionV1,recoverPendingMasterAgentAdoptionsV1 } from '../../src/lib/agent/run/master-adoption'
import { parseCharacterRevisionCandidateDraftV1,decideCharacterRevisionCandidateV1,serializeCharacterRevisionCandidateV1,type CharacterRevisionTaskInputV1 } from '../../src/lib/agent/character-revision-copilot'
import type { WorkspaceScope } from '../../src/lib/types'
const transport=vi.hoisted(()=>({output:'',calls:0}))
vi.mock('../../src/lib/ai/client',async original=>({...await original<any>(),chat:vi.fn(async()=>{transport.calls++;return transport.output})}))
const now = 1_900_000_000_000
const DIRECT_WORKFLOW = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

function request(planId: number | null, characterId: number): CharacterRevisionTaskInputV1 {
  return {
    planId,
    changeType: 'revise-arc',
    characterId,
    characterName: '旧名字会由正式角色卡纠正',
    changeDescription: '让林舟从逃避旧案改为主动追查，但不得改写第一章已经发生的承诺。',
    protectedThroughOrdinal: 1,
    transitionChapterCount: 1,
    strategy: 'balanced',
    anchorNodeIds: [],
    extraRequirements: '保留终局会师，不自动修改正文或主线。',
  }
}

function modelPlan(nodeIds: number[]) {
  return {
    changeSummary: '林舟在已写承诺之后转为主动追查旧案。',
    scopeSummary: '第一章只读保护，第二章过渡，第三章允许重排。',
    affectedWrittenChapters: [{
      ordinal: 1,
      title: '旧城门',
      severity: 'medium',
      reason: '承诺已经写入正文，后续动机不能否定它。',
      evidenceQuotes: ['林舟在旧城门前立下承诺'],
      recommendation: 'protect',
    }],
    immutableFacts: [{
      statement: '林舟已经立下守城承诺。',
      sourceChapterOrdinal: 1,
      evidenceQuote: '林舟在旧城门前立下承诺',
    }],
    conflicts: [],
    foreshadowSuggestions: [{
      chapterOrdinal: 2,
      title: '旧案回声',
      suggestion: '通过故人告知释放旧案新证据。',
    }],
    mainPlotSuggestion: '主线目标不变，只调整林舟进入调查线的方式。',
    options: [
      {
        id: 'light',
        intensity: 'light',
        label: '轻量融入',
        summary: '只调整第二章摘要。',
        risks: ['角色转变较慢'],
        patches: [{
          outlineNodeId: nodeIds[1],
          proposedTitle: '旧案回声',
          proposedSummary: '故人告知旧案出现新证据，林舟决定继续追查。',
          reason: '在保护区后自然切入。',
        }],
      },
      {
        id: 'balanced',
        intensity: 'balanced',
        label: '中度改线',
        summary: '调整第二、三章的调查推进。',
        risks: ['需要复核终局衔接'],
        patches: [
          {
            outlineNodeId: nodeIds[1],
            proposedTitle: '旧案回声',
            proposedSummary: '故人告知旧案出现新证据，林舟决定继续追查。',
            reason: '在保护区后自然切入。',
          },
          {
            outlineNodeId: nodeIds[2],
            proposedTitle: '终局会师',
            proposedSummary: '林舟带着旧案证据与盟友会师，准备正面对抗。',
            reason: '保留终局锚点并承接调查线。',
          },
        ],
      },
      {
        id: 'deep',
        intensity: 'deep',
        label: '深度重构',
        summary: '重排全部未写调查线。',
        risks: ['改动范围较大'],
        patches: [{
          outlineNodeId: nodeIds[2],
          proposedTitle: '终局会师',
          proposedSummary: '林舟整合证据与盟友，在终局前完成会师。',
          reason: '把角色弧光集中到终局。',
        }],
      },
    ],
    warnings: [],
  }
}

async function seedWorkspace() {
  const created = await seedCurrentWorkspace('中途重规划作品')
  const { projectId, worldId, workId } = created.scope
  const scope: WorkspaceScope = { projectId, worldId, workId }
  await db.storyCores.add({
    projectId,
    workId,
    mainPlot: '林舟必须守住旧城并查清旧案。',
    createdAt: now,
    updatedAt: now,
  } as any)
  const characterId = await db.characters.add({
    projectId,
    worldId,
    name: '林舟',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    relationships: '[]',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '守城与旧案主线。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const titles = ['旧城门', '旧案浮现', '终局会师']
  const nodeIds: number[] = []
  for (const [index, title] of titles.entries()) {
    nodeIds.push(await db.outlineNodes.add({
      projectId,
      workId,
      parentId: volumeId,
      type: 'chapter',
      title,
      summary: `原摘要${index + 1}`,
      order: index,
      createdAt: now,
      updatedAt: now + index,
    } as any) as number)
  }
  await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: nodeIds[0],
    title: titles[0],
    content: '<p>林舟在旧城门前立下承诺，绝不让敌人入城。</p>',
    wordCount: 22,
    status: 'draft',
    order: 0,
    notes: '',
    summary: '林舟已立下守城承诺。',
    createdAt: now,
    updatedAt: now,
  } as any)
  await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: nodeIds[1],
    title: titles[1],
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any)
  const planId = await db.characterDrivenPlans.add({
    projectId,
    workId,
    name: '林舟调查线',
    arcs: JSON.stringify([{
      characterId,
      name: '林舟',
      role: '主角',
      initialState: '逃避旧案',
      targetState: '主动承担调查责任',
    }]),
    userHint: '必须服务守城主线',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return { projectId, worldId, workId, scope, characterId, planId, nodeIds }
}
async function pending(){
 const fixture=await seedWorkspace();const characterRevisionRequest=request(fixture.planId,fixture.characterId);transport.output=JSON.stringify(modelPlan(fixture.nodeIds))
 const conversation=await getOrCreateAgentConversation({scope:fixture.scope,projectId:fixture.projectId,worldGroupId:null,purpose:'master-authoring'})
 const result=await runDurableMasterAgentPlanV1({scope:fixture.scope,worldGroupId:null,conversationId:conversation.id,plan:{summary:'角色中途重规划',workflow:DIRECT_WORKFLOW,tasks:[{id:'revision-1',agentId:'outline',skillId:'outline.character-revision',instruction:'分析林舟的变更并规划未来旧案剧情',dependsOn:[],characterRevisionRequest}]}})
 const candidate=result.candidates[0];const parsed=parseCharacterRevisionCandidateDraftV1(candidate.draft,candidate.payload.baseSnapshot as any);const decided=decideCharacterRevisionCandidateV1(parsed,'balanced',[fixture.nodeIds[1],fixture.nodeIds[2]])
 const draft=serializeCharacterRevisionCandidateV1(decided);await updateAgentEventCandidate(candidate.event.id!,fixture.projectId,draft,fixture.scope)
 const ref={scope:fixture.scope,runId:result.runId,candidateEventId:candidate.event.id!,worldGroupId:null};await beginMasterAgentCandidateAdoptionV1(ref)
 return {fixture,ref,result,draft,candidate}
}
describe.sequential('character revision master stale repair',()=>{
 beforeEach(async()=>{await db.delete();await db.open();transport.calls=0;vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN_AUDIT'))})
 afterEach(()=>{vi.restoreAllMocks();db.close()})
 it('normal zero-write intent recovery applies the two author-selected future patches',async()=>{const p=await pending();const r=await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope);expect(r.failed).toEqual([]);expect(r.recoveredRunIds).toEqual([p.result.runId]);expect((await db.outlineNodes.get(p.fixture.nodeIds[1]))!.title).toBe('旧案回声');expect(transport.calls).toBe(1)})
 it('ordinary commit refuses a later change to the selected plan author input',async()=>{const p=await pending();await db.characterDrivenPlans.update(p.fixture.planId,{userHint:'作者新方向：放弃旧案调查，改走沙漠求援。',updatedAt:now+500});await expect(commitMasterAgentCandidateAdoptionV1(p.ref)).rejects.toThrow('已经变化');expect((await db.outlineNodes.get(p.fixture.nodeIds[1]))!.title).toBe('旧案浮现')})
 it('automatic recovery refuses the old patches after the selected plan author hint changes', async () => {
  const p = await pending()
  const before = await db.outlineNodes.bulkGet(p.fixture.nodeIds)
  const userHint = '作者新方向：放弃旧案调查，改走沙漠求援。'
  await db.characterDrivenPlans.update(p.fixture.planId, { userHint, updatedAt: now + 500 })
  const result = await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope)
  expect(result.failed).toEqual([{ runId: p.result.runId, reason: expect.stringMatching(/已经变化|过期/) }])
  expect(result.recoveredRunIds).toEqual([])
  expect(await db.outlineNodes.bulkGet(p.fixture.nodeIds)).toEqual(before)
  expect((await db.characterDrivenPlans.get(p.fixture.planId))?.userHint).toBe(userHint)
  expect(transport.calls).toBe(1)
 })

 it.each(['partial', 'same-length-prose', 'target-changed'] as const)('handles %s after the first selected role patch', async mode => {
  const p = await pending()
  const fixture = p.fixture
  const patch = modelPlan(fixture.nodeIds).options[1].patches[0]
  const written = await adopt({ scope: fixture.scope, projectId: fixture.projectId, target: 'outlineNodes',
    recordId: patch.outlineNodeId, mode: 'replace', data: { title: patch.proposedTitle, summary: patch.proposedSummary } })
  expect(written.written).toHaveLength(1)
  if (mode === 'same-length-prose') {
    const chapter = (await db.chapters.toArray()).find(row => row.outlineNodeId === fixture.nodeIds[0])!
    const changed = chapter.content.replace('林舟', '夏江')
    expect(changed.length).toBe(chapter.content.length)
    expect(changed).not.toBe(chapter.content)
    await db.chapters.update(chapter.id!, { content: changed })
  } else if (mode === 'target-changed') {
    await db.outlineNodes.update(patch.outlineNodeId, { summary: '作者已写入自己的新摘要。' })
  }
  const before = await db.outlineNodes.bulkGet(fixture.nodeIds)
  const result = await recoverPendingMasterAgentAdoptionsV1(fixture.scope)
  if (mode === 'partial') {
    expect(result).toEqual({ recoveredRunIds: [p.result.runId], failed: [] })
    const linkedChapter = (await db.chapters.toArray()).find(row => row.outlineNodeId === patch.outlineNodeId)
    expect(linkedChapter?.title).toBe(patch.proposedTitle)
    expect((await db.outlineNodes.get(fixture.nodeIds[2]))?.summary).toContain('旧案证据')
  } else {
    expect(result.failed[0]?.reason).toMatch(/已经变化|过期/)
    expect(result.recoveredRunIds).toEqual([])
    expect(await db.outlineNodes.bulkGet(fixture.nodeIds)).toEqual(before)
  }
  expect(transport.calls).toBe(1)
 })

})
