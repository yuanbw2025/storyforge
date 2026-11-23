import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import WorldviewAgentControls from '../../src/components/worldview/WorldviewAgentControls'
import { useMasterCopilot } from '../../src/components/agent/useMasterCopilot'
import { ToastProvider } from '../../src/components/shared/Toast'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { formatWorldviewFieldGenerationRequestV1, parseWorldviewFieldCandidateDraft,
  parseWorldviewFieldCandidateDraftV2, formatWorldviewFieldGenerationRequestV2 } from '../../src/lib/agent/worldview-field-copilot'
import { parseAuthorLengthIntentV1, createAuthorLengthIntentV1 } from '../../src/lib/ai/author-length-intent'
import { resolveWorldviewLengthPlanV2, parseWorldviewFieldTaskV2 } from '../../src/lib/agent/worldview-field-v2-contract'
import { formatMasterBudgetSummaryV2, admitPreparedMasterPlanV2, runMasterWithWorldviewV2, adoptMasterWithWorldviewV2, verifyMasterWithWorldviewV2, findEndableWorldviewRunV2, endWorldviewMasterRunV2, readWorldviewReceivedContentV2 } from '../../src/lib/agent/run/master-worldview-v2'
import { restoreWorldviewFieldMasterV2, inspectWorldviewRoundV2, projectWorldviewImportedHistoryV2 } from '../../src/lib/agent/run/worldview-field-v2-durable'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import * as artifacts from '../../src/lib/memory/artifact-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { AGENT_SKILLS, validateAgentSkillDefinitionsV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as runEvents from '../../src/lib/agent/run/event-store'
import * as conversations from '../../src/lib/agent/conversations'
import type { AuthorLengthIntentV1 } from '../../src/lib/types/agent-run'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import type { AIConfig } from '../../src/lib/types'


const reactActGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mountControls(node: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(node))
}
async function unmountControls() {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
}
function button(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === name)
  if (!found) throw new Error('Missing button: ' + name)
  return found
}
function receivedRegion() {
  const found = document.querySelector<HTMLElement>('[role="region"][aria-label="已收到的原始内容"]')
  if (!found) throw new Error('Missing received public content region')
  return found
}
async function waitFor(check: () => unknown | Promise<unknown>, options?: { timeout: number }) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); await check() }, options)
}
async function click(name: string) { await act(async () => button(name).click()) }
async function setHint(value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[placeholder="给 AI 的补充说明（可选）"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const config:AIConfig={provider:'custom',model:'b02-inert-synthetic',baseUrl:'https://b02.invalid/v1',apiKey:'',temperature:0,maxTokens:2000}
const template:PromptTemplate={id:100,scope:'user',moduleKey:'worldview.dimension',promptType:'generate',name:'B02 test',description:'fixture',
  systemPrompt:'保正式事实，只输出当前字段对象。',userPromptTemplate:'{{dimension}} {{userHint}} {{worldContext}}',variables:['dimension','userHint','worldContext'],isActive:true,createdAt:1,updatedAt:1}
const priorTemplates=usePromptStore.getState().templates
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
let restoreLocks:(()=>void)|undefined
beforeEach(async()=>{restoreLocks=installEvalWebLocksFixtureV1();await db.delete();await db.open();resetModelCapacityForTestsV1();
  useAIConfigStore.setState({config,presets:[],taskRoutes:{}});usePromptStore.setState({templates:[structuredClone(template)]});vi.stubGlobal('location',{hostname:'localhost'})})
afterEach(async()=>{await unmountControls();restoreLocks?.();usePromptStore.setState({templates:priorTemplates});vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
async function fixture(intent:AuthorLengthIntentV1|null=null) {
  const {scope}=await seedCurrentWorkspace('B02 完整单字段')
  const now=Date.now(),worldviewId=await db.worldviews.add(stampNewRecord(scope,'worldviews',{projectId:scope.projectId,
    worldOrigin:'',worldStructure:'正式边界。'.repeat(12000)+'世界来源尾部保留标记',createdAt:now,updatedAt:now},{owner:'world'}) as never) as number
  const conversation=await getOrCreateAgentConversation({projectId:scope.projectId,scope,worldGroupId:null,purpose:'b02-test',title:'B02'})
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  const instruction=formatWorldviewFieldGenerationRequestV1({field:'worldOrigin',mode:'rewrite',hint:'保留正式世界的末段约束。'})
  const plan=await createMasterAgentPlan({projectId:scope.projectId,scope,worldGroupId:null,request:instruction,pinnedTask:{
    agentId:'world-origin',skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:intent,instruction,
    promptExecution:{version:1,moduleKey:'worldview.dimension'}}})
  return {scope,worldviewId,conversationId:conversation.id!,worldGroupId:null,plan}
}
function http(answers:readonly (string|Record<string,unknown>|Response|Error)[],onPost?:(index:number,body:Record<string,unknown>)=>void|Promise<void>) {
  const posts:string[]=[],metadata:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    if(init?.method!=='POST') {metadata.push(String(url));if(String(url)!=='https://b02.invalid/api/v1/models')throw new Error('unexpected metadata');return json({models:[]})}
    const index=posts.length,wire=String(init.body);posts.push(wire);await onPost?.(index,JSON.parse(wire))
    const answer=answers[index]
    if(answer===undefined)throw new Error('unexpected additional generation POST')
    if(answer instanceof Error)throw answer
    if(answer instanceof Response)return answer
    return json({choices:[{message:{content:JSON.stringify(typeof answer==='string'?{field:'worldOrigin',value:answer}:answer),reasoning_content:'HIDDEN'},finish_reason:'stop'}],
      usage:{prompt_tokens:0,completion_tokens:index+1,total_tokens:index+1}})
  }))
  return {posts,metadata}
}
const exact=(words:number)=>createAuthorLengthIntentV1({quantifier:'exact',targetWords:words,basis:'final-text',source:'control'})

describe.sequential('B02 C1–C6 · ordinary UI task to same-client durable candidate',()=>{
  it('preserves the deterministic prose consistency registration while admitting only the new exact product profile', () => {
    expect(AGENT_SKILLS.find(skill => skill.id === 'prose.consistency')?.maxOutputTokens).toBe(1)
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS)).not.toThrow()
    const invalid = AGENT_SKILLS.map(skill => skill.id === 'prose.consistency' ? { ...skill, maxOutputTokens: null } : skill)
    expect(() => validateAgentSkillDefinitionsV1(invalid)).toThrow('prose.consistency')
  })

  it('formats frozen service and finite evidence plus real V2 zero or unreported usage without inventing a quota', async () => {
    const usedTokens = 1234
    const service = { ...new AgentTeamBudgetTracker('service-capacity').snapshot(), usedTokens, calls: 2, canonRetries: 1 }
    const finite = { ...new AgentTeamBudgetTracker('balanced').snapshot(), usedTokens, calls: 2, canonRetries: 1 }
    expect(formatMasterBudgetSummaryV2(service)).toBe(`本轮团队约使用 ${usedTokens.toLocaleString()} tokens，2 次调用，Canon 受控打回 1 次。`)
    expect(formatMasterBudgetSummaryV2(finite)).toBe(`本轮团队约使用 ${usedTokens.toLocaleString()} / ${finite.maxTokens.toLocaleString()} tokens，2 次调用，Canon 受控打回 1 次。`)
    const f = await fixture(), sent = http(['潮汐之城延续已定祭仪。'])
    const run = await runMasterWithWorldviewV2(f)
    expect(sent.posts).toHaveLength(1)
    expect(run.budgetEvidence).toMatchObject({ observedInputTokens: 0, observedOutputTokens: 1 })
    expect(formatMasterBudgetSummaryV2(run.budgetEvidence)).toBe('本轮 1 次调用；实际输入 0 tokens，实际输出 1 tokens。')
    expect(formatMasterBudgetSummaryV2({ ...run.budgetEvidence, observedInputTokens: null, observedOutputTokens: null }))
      .toBe('本轮 1 次调用；实际输入 服务未报告 tokens，实际输出 服务未报告 tokens。')
  })

  it.each(['invalid', 'unknown', 'delta-only'] as const)('ordinary controls retain artifact-backed %s public content through remount, view and explicit end without inference or adoption', async kind => {
    const f = await fixture(), project = (await db.projects.get(f.scope.projectId))!
    const publicText = '【公开原答首】' + '已收到但不是合法候选的完整内容。'.repeat(8000) + '【公开原答尾】'
    const expectedHash = await sha256Text(publicText)
    const response = kind === 'invalid'
      ? json({ choices: [{ message: { content: publicText, reasoning_content: 'HIDDEN' }, finish_reason: 'stop' }] })
      : new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: publicText.slice(0, 70000) } }] }) + '\n\n'
        + 'data: ' + JSON.stringify({ choices: [{ delta: { content: publicText.slice(70000) } }] }) + '\n\n'
        + 'data: INVALID-HIDDEN\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    if (kind === 'delta-only') {
      const record = artifacts.recordAgentRunArtifactV1
      vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
        if (input.artifactKind === 'raw-response' && input.content.includes('"version":"worldview-field-response-v2"')) {
          throw new Error('synthetic response-envelope write interrupted after public deltas')
        }
        return record(input)
      })
    }
    const sent = http([response])
    let generationFinished = false
    function OrdinaryControls() {
      const copilot = useMasterCopilot({ project, worldGroupId: null })
      const candidate = copilot.pendingCandidates.find(item => item.payload.worldviewField === 'worldOrigin')
      return createElement(WorldviewAgentControls, { field: 'worldOrigin', project, activeGroupId: null, copilot, candidate,
        hasOtherPendingCandidates: false, onRunningChange: running => { generationFinished = !running }, onAdopted: async () => undefined })
    }
    const mount = () => mountControls(createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(OrdinaryControls))))
    await mount()
    await waitFor(() => expect(button('AI 生成').disabled).toBe(false))
    await click('AI 生成')
    await waitFor(() => expect(button('查看已收到的内容').disabled).toBe(false), { timeout: 15000 })
    await waitFor(() => expect(generationFinished).toBe(true))
    expect(sent.posts).toHaveLength(1)
    const run = (await db.agentRuns.toArray())[0]
    expect((await db.agentEvents.toArray()).filter(row => row.kind === 'candidate')).toHaveLength(0)
    const before = await readAgentRunV1(f.scope, run.id!)
    const requested = before.events.filter(event => event.type === 'model.requested')
    expect(requested).toHaveLength(1)
    const rawEvents = before.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    const bodies: Array<Record<string, unknown>> = []
    for (const event of rawEvents) {
      if (event.type !== 'evidence.artifact.recorded') continue
      bodies.push(JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
        artifactKind: 'raw-response', contentHash: event.payload.contentHash })) as Record<string, unknown>)
    }
    const full = bodies.find(body => body.version === 'worldview-field-response-v2')
    if (kind === 'delta-only') {
      expect(full).toBeUndefined()
      expect(before.events.some(event => event.type === 'model.responded')).toBe(false)
      expect(bodies.filter(body => body.version === 'worldview-field-delta-v2').map(body => body.text).join('')).toBe(publicText)
    } else {
      expect(full).toMatchObject({ rawTextHash: expectedHash, response: { text: publicText } })
      expect(requested[0].type === 'model.requested' && requested[0].payload.bindingHash).toBe(full!.callId)
    }
    const artifactsBefore = await db.agentRunArtifacts.toArray()
    const view = async () => {
      await click('查看已收到的内容')
      await waitFor(() => expect(receivedRegion().textContent).toBe(publicText), { timeout: 15000 })
      expect(await sha256Text(receivedRegion().textContent!)).toBe(expectedHash)
      expect(receivedRegion().textContent).not.toContain('HIDDEN')
      expect(sent.posts).toHaveLength(1)
      expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
      expect(await db.agentRunArtifacts.toArray()).toEqual(artifactsBefore)
    }
    await view()
    await unmountControls(); await mount()
    await waitFor(() => expect(button('查看已收到的内容').disabled).toBe(false))
    await view()
    await click('结束此未完成任务')
    await waitFor(async () => expect((await readAgentRunV1(f.scope, run.id!)).projection.state).toBe('cancelled'))
    await unmountControls(); await mount()
    await waitFor(() => expect(button('查看已收到的内容').disabled).toBe(false))
    await view()
    expect((await db.agentEvents.toArray()).filter(row => row.kind === 'candidate')).toHaveLength(0)
    await expect(readWorldviewReceivedContentV2({ scope: f.scope, conversationId: before.run.conversationId!,
      worldGroupId: null, runId: run.id!, field: 'races' })).rejects.toThrow('字段')
  }, 30000)

  it('ordinary hook restores an edited multi-round candidate after remount and completes adoption without a legacy chapter handoff or extra POST', async () => {
    const f = await fixture(), project = (await db.projects.get(f.scope.projectId))!
    const sent = http([40, 60, 80, 100].map(words => '甲'.repeat(words)))
    let finished = false, adoption: Promise<unknown> | undefined
    function FullOrdinaryControls() {
      const copilot = useMasterCopilot({ project, worldGroupId: null })
      const candidate = copilot.pendingCandidates.find(item => item.payload.worldviewField === 'worldOrigin')
      return createElement(WorldviewAgentControls, { field: 'worldOrigin', project, activeGroupId: null, copilot, candidate,
        hasOtherPendingCandidates: false, onRunningChange: running => { finished = !running },
        onAdopted: async pending => { adoption = copilot.adoptCandidate(pending); await adoption } })
    }
    const mount = () => mountControls(createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(FullOrdinaryControls))))
    await mount(); await waitFor(() => expect(button('AI 生成').disabled).toBe(false))
    await click('重写')
    await act(async () => {
      const select = document.querySelector<HTMLSelectElement>('[aria-label="篇幅安排"]')!
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'exact')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="目标字数"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '100')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('AI 生成'); await waitFor(() => expect(finished).toBe(true), { timeout: 15000 })
    expect(sent.posts).toHaveLength(4)
    const run = (await db.agentRuns.toArray())[0], rawBefore = (await db.agentRunArtifacts.toArray()).filter(row => row.artifactKind === 'raw-response')
    const edited = '甲'.repeat(100) + '\n作者已经保存的补注。'
    await act(async () => {
      const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="世界来源候选内容"]')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, edited)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(async () => {
      const row = (await db.agentEvents.toArray()).find(event => event.kind === 'candidate')!
      expect(JSON.parse(row.content).value).toBe(edited)
      expect(button('采纳').disabled).toBe(false)
    })
    await unmountControls(); await mount()
    await waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('[aria-label="世界来源候选内容"]')?.value).toBe(edited), { timeout: 15000 })
    expect(document.body.textContent).not.toContain('主 Agent 计划检查点')
    expect(sent.posts).toHaveLength(4)
    await click('采纳'); expect(adoption).toBeDefined(); await act(async () => { await adoption })
    await waitFor(async () => expect((await readAgentRunV1(f.scope, run.id!)).projection.state).toBe('completed'))
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe(edited)
    expect(document.querySelector('[aria-label="世界来源候选内容"]')).toBeNull()
    expect(document.body.textContent).not.toContain('章后流程尚未完成')
    expect(await db.chapters.count()).toBe(0); expect(await db.agentRuns.count()).toBe(1)
    expect((await db.agentRunArtifacts.toArray()).filter(row => row.artifactKind === 'raw-response')).toEqual(rawBefore)
    const final = await readAgentRunV1(f.scope, run.id!)
    expect(final.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(final.events.filter(event => event.type === 'model.requested')).toHaveLength(4)
    expect(sent.posts).toHaveLength(4)
  }, 30000)

  it.each(['mixed','forged-v2','old-forged'] as const)('the real hook refuses %s plans before a Run or model POST',async kind=>{
    const f=await fixture(),project=(await db.projects.get(f.scope.projectId))!,sent=http(['must-not-send'])
    let plan=structuredClone(f.plan)
    if(kind==='mixed')plan={...plan,tasks:[...plan.tasks,{id:'old',agentId:'prose',skillId:'prose.generate',instruction:'生成第1章正文',dependsOn:[]}]}
    else if(kind==='forged-v2')(plan.tasks[0] as unknown as {worldviewFieldPromptV2:{templateHash:string}}).worldviewFieldPromptV2.templateHash='0'.repeat(64)
    else plan={summary:'旧计划不能带新权限',workflow:plan.workflow,tasks:[{id:'old',agentId:'world-origin',skillId:'world-origin.worldview-field',instruction:plan.tasks[0].instruction,dependsOn:[],unexpectedPermission:true}]} as never
    let submission: Promise<unknown> | undefined
    function Probe(){const copilot=useMasterCopilot({project,worldGroupId:null});return createElement('div',null,
      createElement('button',{disabled:copilot.loading||copilot.busy,onClick:()=>{submission=copilot.submitRequest('确认检查计划。',{confirmedPlan:plan})}},'检查实际计划'),
      createElement('output',{'data-testid':'master-admission-error'},copilot.error))}
    await mountControls(createElement(ToastProvider,null,createElement(DialogProvider,null,createElement(Probe))))
    await waitFor(()=>expect(button('检查实际计划').disabled).toBe(false))
    await click('检查实际计划')
    expect(submission).toBeDefined()
    await act(async () => { await submission })
    await waitFor(()=>expect(document.querySelector('[data-testid="master-admission-error"]')!.textContent).toBeTruthy())
    expect(sent.posts).toHaveLength(0);expect(await db.agentRuns.count()).toBe(0)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
  })
  it('admits only a strictly parsed single worldview V2 plan, preserving legacy validation and rejecting mixed/forged plans before inference',async()=>{
    const f=await fixture(),sent=http(['must-not-send'])
    const admitted=await admitPreparedMasterPlanV2(f.plan)
    expect(admitted).toEqual({current:f.plan,remaining:null})
    const mixed={...f.plan,tasks:[...f.plan.tasks,{id:'old',agentId:'prose' as const,skillId:'prose.generate' as const,instruction:'生成第1章正文',dependsOn:[]}]}
    await expect(admitPreparedMasterPlanV2(mixed)).rejects.toThrow()
    const forged=structuredClone(f.plan)
    ;(forged.tasks[0] as unknown as {worldviewFieldPromptV2:{templateHash:string}}).worldviewFieldPromptV2.templateHash='0'.repeat(64)
    await expect(admitPreparedMasterPlanV2(forged)).rejects.toThrow()
    await expect(admitPreparedMasterPlanV2({...f.plan,workflow:{version:1,workflowId:'invented',reasonCodes:[]}} as never)).rejects.toThrow()
    const legacy={summary:'原单任务计划',tasks:[{id:'old',agentId:'prose' as const,skillId:'prose.generate' as const,instruction:'生成第1章正文',dependsOn:[]}],workflow:f.plan.workflow}
    expect(await admitPreparedMasterPlanV2(legacy)).toEqual({current:legacy,remaining:null})
    await expect(admitPreparedMasterPlanV2({...legacy,tasks:[{...legacy.tasks[0],unexpectedPermission:true}]} as never)).rejects.toThrow()
    expect(sent.posts).toHaveLength(0);expect(await db.agentRuns.count()).toBe(0)
  })
  it.each(['active-work','source','template','temperature'] as const)('stops %s changed during an actual persisted context-manifest write before POST and keeps pre-dispatch witnesses',async change=>{
    const f=await fixture(),sent=http(['must-not-send'])
    const otherWork=change==='active-work' ? await createWorldWork(f.scope.projectId,{title:'另一真实作品',kind:'novel',novelProfile:'long'}) : null
    const record=artifacts.recordAgentRunArtifactV1
    let changed=false
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{
      const saved=await record(input)
      if(!changed&&input.artifactKind==='context-manifest'){
        changed=true
        if(change==='active-work')await switchActiveWork(f.scope.projectId,otherWork!.id!)
        else if(change==='source')await db.worldviews.update(f.worldviewId,{worldStructure:'作者在落盘等待期间改变正式来源。',updatedAt:Date.now()})
        else if(change==='template')usePromptStore.setState({templates:[{...template,systemPrompt:'作者在落盘等待期间改变有效模板。',updatedAt:2}]})
        else useAIConfigStore.setState({config:{...config,temperature:0.95}})
      }
      return saved
    })
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow()
    expect(changed).toBe(true)
    expect(sent.posts).toHaveLength(0)
    const run=(await db.agentRuns.toArray())[0]
    expect(run).toBeTruthy()
    const snapshot=await readAgentRunV1(f.scope,run.id!)
    const members=snapshot.events.filter(e=>e.type==='evidence.artifact.recorded')
    expect(members.some(e=>e.payload.artifactKind==='rendered-request')).toBe(true)
    expect(members.some(e=>e.payload.artifactKind==='context-manifest')).toBe(true)
    const callBodies: Array<Record<string, unknown>> = []
    for (const event of members) {
      if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'tool-result') {
        callBodies.push(JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
          artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })) as Record<string, unknown>)
      }
    }
    expect(callBodies.some(body => body.version === 'worldview-field-call-v2' && body.runId === run.id)).toBe(true)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
    expect(snapshot.events.some(e=>e.type==='model.responded')).toBe(false)
  },30000)

  it('keeps complete >120k answer, >8000-token baseline tail, actual plan before POST, restore and original adopt',async()=>{
    const f=await fixture(),answer='正文'.repeat(65000)+'完整输出尾标'
    const sent=http([answer],async(_index,body)=>{
      const runs=await db.agentRuns.toArray();expect(runs).toHaveLength(1);expect(runs[0].contractVersion).toBe(3)
      const members=await db.agentRunArtifacts.toArray();expect(members.some(row=>row.artifactKind==='rendered-request')).toBe(true)
      expect(await db.agentRunCheckpoints.count()).toBeGreaterThan(0)
      expect(body).not.toHaveProperty('max_tokens')
      expect(JSON.stringify(body.messages)).toContain('世界来源尾部保留标记')
      expect(JSON.stringify(body.messages)).toContain('4000')
    })
    let actualPlan:unknown
    const result=await runMasterWithWorldviewV2({...f,onLengthPlan:plan=>{actualPlan=plan}})
    expect(actualPlan).toMatchObject({mode:'automatic',referenceWords:4000,operation:'create'})
    expect(actualPlan).not.toHaveProperty('maxWords');expect(sent.posts).toHaveLength(1)
    const restored=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(restored.candidates[0].draft).toContain('完整输出尾标')
    expect(parseWorldviewFieldCandidateDraftV2(restored.candidates[0].draft).value).toBe(answer)
    expect(()=>parseWorldviewFieldCandidateDraft(restored.candidates[0].draft)).toThrow()
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
    expect(restored.sourceCaptures[1].rawText).toContain('世界来源尾部保留标记')
    expect(restored.sourceCaptures[1].rawText).not.toContain('serialized')
    expect(restored.assembled.trimmed).toEqual([])
    expect(restored.assembled.sourceEvidence?.every(source=>source.delivery==='full')).toBe(true)
    const rawRecords=(await db.agentRunArtifacts.toArray()).filter(row=>row.artifactKind==='raw-response')
    expect(rawRecords.some(row=>row.content?.includes('HIDDEN'))).toBe(false)
    const adopted=await adoptMasterWithWorldviewV2({scope:f.scope,runId:result.runId,candidateEventId:restored.candidates[0].event.id!,worldGroupId:null})
    expect(adopted.adoptionHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe(answer)
    expect((await verifyMasterWithWorldviewV2({scope:f.scope,runId:result.runId})).accepted).toBe(true)
    expect(sent.posts).toHaveLength(1)
  },30000)

  it('rolls back the real field and all confirmation/adoption journal writes when a later terminal write fails', async () => {
    const f = await fixture(), sent = http(['只能在整个原事务成功后采用。'])
    const result = await runMasterWithWorldviewV2(f), restored = await restoreWorldviewFieldMasterV2(f.scope, result.runId)
    const before = await readAgentRunV1(f.scope, result.runId)
    const append = runEvents.appendPrivilegedAgentRunEventInTransactionV1
    let reachedAfterAdoption = false
    vi.spyOn(runEvents, 'appendPrivilegedAgentRunEventInTransactionV1').mockImplementation(async (snapshot, event) => {
      if (event.type === 'step.succeeded') {
        reachedAfterAdoption = true
        expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('只能在整个原事务成功后采用。')
        throw new Error('synthetic terminal write fails after field adoption')
      }
      return append(snapshot, event)
    })
    await expect(adoptMasterWithWorldviewV2({ scope: f.scope, runId: result.runId,
      candidateEventId: restored.candidates[0].event.id!, worldGroupId: null })).rejects.toThrow('synthetic terminal')
    expect(reachedAfterAdoption).toBe(true)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
    const after = await readAgentRunV1(f.scope, result.runId)
    expect(after.projection.lastSequence).toBe(before.projection.lastSequence)
    expect(after.events).toEqual(before.events)
    expect(sent.posts).toHaveLength(1)
  }, 30000)

  it.each([
    {label:'explicit zero overrides both template and routed default',requestTemperature:0,templateTemperature:0.65,expected:0},
    {label:'template sampling survives the same frozen route',requestTemperature:undefined,templateTemperature:0.65,expected:0.65},
    {label:'no author sampling keeps the routed preset',requestTemperature:undefined,templateTemperature:undefined,expected:0.95},
  ])('$label without adding options or restoring template output quotas',async({requestTemperature,templateTemperature,expected})=>{
    usePromptStore.setState({templates:[{...structuredClone(template),modelOverride:{
      ...(templateTemperature===undefined?{}:{temperature:templateTemperature}),maxTokens:123}}]})
    useAIConfigStore.setState({config:{...config,temperature:0},presets:[
      {id:'world-route',name:'World role route',config:{...config,apiKey:'synthetic-b02-only',model:'b02-world-route',temperature:0.95}},
      {id:'review-route',name:'Different review route',config:{...config,apiKey:'synthetic-b02-only',model:'b02-review-route',temperature:0.4}},
    ],taskRoutes:{'agent-world-origin':'world-route',review:'review-route'}})
    const f=await fixture(),instruction=f.plan.tasks[0].instruction
    const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:instruction,pinnedTask:{
      agentId:'world-origin',skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:null,instruction,
      promptExecution:{version:1,moduleKey:'worldview.dimension',...(requestTemperature===undefined?{}:{temperature:requestTemperature})}}})
    const sent=http(['保留完整路由、温度和正式边界。']),result=await runMasterWithWorldviewV2({...f,plan})
    expect(sent.posts).toHaveLength(1)
    const wire=JSON.parse(sent.posts[0]) as Record<string,unknown>
    expect(wire).toMatchObject({model:'b02-world-route',temperature:expected})
    expect(wire).not.toHaveProperty('max_tokens')
    const restored=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    const requestPlan = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
      artifactKind: restored.state.planRef.artifactKind, contentHash: restored.state.planRef.contentHash })) as { request: { sentParameters: unknown } }
    expect(requestPlan.request.sentParameters).toMatchObject({model:'b02-world-route',temperature:expected})
    expect(restored.wire.options).toEqual({})
    expect(restored.root.task.worldviewFieldPromptV2.template.modelOverride?.maxTokens).toBe(123)
    expect(restored.root.task.worldviewFieldPromptV2.request.maxTokens).toBeUndefined()
    await runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,conversationId:f.conversationId,runId:result.runId})
    expect(sent.posts).toHaveLength(1)
  },30000)

  it('keeps all four long native object string fields through capture, aggregate counting, restoration and original adoption',async()=>{
    const f=await fixture(),piece='自然资源完整细节。'.repeat(3000)
    const original={rareCreatures:piece+'OLD_RARE_TAIL',herbs:piece+'OLD_HERB_TAIL',minerals:piece+'OLD_MINERAL_TAIL',others:piece+'OLD_OTHER_TAIL'}
    await db.worldviews.update(f.worldviewId,{naturalResources:original})
    const values={rareCreatures:piece+'NEW_RARE_TAIL',herbs:piece+'NEW_HERB_TAIL',minerals:piece+'NEW_MINERAL_TAIL',others:piece+'NEW_OTHER_TAIL'}
    const instruction=formatWorldviewFieldGenerationRequestV1({field:'naturalResources',mode:'rewrite',hint:'分别完整保留四项职责。'})
    const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:instruction,pinnedTask:{agentId:'world-origin',
      skillId:'world-origin.worldview-field.v2',targetField:'naturalResources',authorLengthIntent:null,instruction,promptExecution:{version:1,moduleKey:'worldview.dimension'}}})
    const sent=http([{field:'naturalResources',value:values}]),generated=await runMasterWithWorldviewV2({...f,plan})
    const read=await restoreWorldviewFieldMasterV2(f.scope,generated.runId)
    for(const tail of ['OLD_RARE_TAIL','OLD_HERB_TAIL','OLD_MINERAL_TAIL','OLD_OTHER_TAIL'])expect(sent.posts[0]).toContain(tail)
    expect(parseWorldviewFieldCandidateDraftV2(read.candidates[0].draft).value).toEqual(values)
    expect(read.root.lengthPlan).toMatchObject({taskKind:'setting-set',mode:'automatic',referenceWords:null,components:expect.any(Array)})
    const actualMessages=(JSON.parse(sent.posts[0]) as {messages:Array<{content:string}>}).messages.map(message=>message.content).join('\n')
    for(const key of ['rareCreatures','herbs','minerals','others'])expect(actualMessages).toContain(`${key}：约4000字作为参考`)
    expect(actualMessages).toContain('参考值不是上限')
    expect(read.rounds[0].observation.finalWords).toBe(Object.values(values).join('').replace(/\s/g,'').length)
    await adoptMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,runId:generated.runId,candidateEventId:read.candidates[0].event.id!})
    expect((await db.worldviews.get(f.worldviewId))?.naturalResources).toEqual(values)
    expect(sent.posts).toHaveLength(1)
  },30000)

  it('makes semantic length revisions with strict distance progress and all exact drafts, not a fixed retry count',async()=>{
    const f=await fixture(exact(100)),sent=http(['甲'.repeat(50),'乙'.repeat(75),'丙'.repeat(100)])
    const result=await runMasterWithWorldviewV2(f),read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(sent.posts).toHaveLength(3);expect(read.rounds.map(round=>round.observation.distance)).toEqual([50,25,0])
    expect(read.state.roundRefs).toHaveLength(3);expect(new Set(read.rounds.map(round=>round.rawRef.contentHash)).size).toBe(3)
    expect(new Set(read.rounds.map(round=>round.planHash)).size).toBe(3)
    expect(read.snapshot.projection.generation).toBe(3)
    for(const ref of read.state.roundRefs)expect((await inspectWorldviewRoundV2({scope:f.scope,runId:result.runId,roundRef:ref})).runId).toBe(result.runId)
    expect(read.candidates[0].payload.worldviewFieldV2?.disposition).toBe('ready')
    expect(read.candidates[0].payload.worldviewFieldV2?.lengthObservation.measuredWords).toBe(100)
    expect(read.snapshot.contract.budget).toMatchObject({allocation:{mode:'adaptive-plan',hardConstraints:null}})
  },30000)

  it('reads complete registered worldRulesProfiles and includes its real table in atomic adoption',async()=>{
    const f=await fixture(),now=Date.now(),tail='规则尾部：铜铃不能改变过去。'
    const note='世界规则的完整限制。'.repeat(3000)+tail
    await db.worldRulesProfiles.add(stampNewRecord(f.scope,'worldRulesProfiles',{
      projectId:f.scope.projectId,worldGroupId:null,entries:{},customNodes:[],globalNote:note,createdAt:now,updatedAt:now,
    },{owner:'world'}))
    const sent=http(['遵循完整规则的候选']),result=await runMasterWithWorldviewV2(f)
    const read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(read.assembled.text).toContain(note)
    expect(sent.posts[0]).toContain(tail)
    await adoptMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,runId:result.runId,candidateEventId:read.candidates[0].event.id!})
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('遵循完整规则的候选')
    expect(sent.posts).toHaveLength(1)
  },20000)
  it('ordinary UI long hint crosses the real hook product admission before the V1 splitter and reaches the exact prepared wire',async()=>{
    const f=await fixture(),hint='作者完整约束。'.repeat(1600)+'末尾硬约束：潮门只能朝海开启。'
    expect(()=>formatWorldviewFieldGenerationRequestV1({field:'worldOrigin',mode:'expand',hint})).toThrow('8000')
    const project=await db.projects.get(f.scope.projectId)
    if(!project)throw new Error('ordinary UI fixture needs its real workspace')
    let generationFinished = false
    function OrdinaryControls() {
      const copilot=useMasterCopilot({project:project!,worldGroupId:null})
      const candidate=copilot.pendingCandidates.find(item=>item.payload.worldviewField==='worldOrigin')
      return createElement(WorldviewAgentControls,{field:'worldOrigin',project:project!,activeGroupId:null,copilot,candidate,
        hasOtherPendingCandidates:false,onRunningChange:running=>{generationFinished=!running},onAdopted:async()=>undefined})
    }
    const sent=http(['完整候选'])
    await mountControls(createElement(ToastProvider,null,createElement(DialogProvider,null,createElement(OrdinaryControls))))
    await waitFor(()=>expect(button('AI 生成').disabled).toBe(false))
    await setHint(hint)
    await click('AI 生成')
    await waitFor(async()=>expect((await db.agentEvents.toArray()).filter(event=>event.kind==='candidate')).toHaveLength(1),{timeout:15000})
    await waitFor(()=>expect(generationFinished).toBe(true))
    const run=(await db.agentRuns.toArray())[0]
    const read=await restoreWorldviewFieldMasterV2(f.scope,run.id!)
    const instruction=formatWorldviewFieldGenerationRequestV2({field:'worldOrigin',mode:'expand',hint})
    expect(read.root.task.instruction).toBe(instruction)
    expect(sent.posts).toHaveLength(1)
    const actual=JSON.parse(sent.posts[0]) as {messages:Array<{content:string}>}
    expect(actual.messages.map(message=>message.content).join('\n')).toContain(hint)
    expect(read.assembled.text).toContain(hint)
    await waitFor(()=>expect(Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).some(item => /待确认/.test(item.textContent ?? ''))).toBe(true))
  },30000)
  it.each(['rewrite','polish'] as const)('actual %s operation cannot inherit a hidden control additional-text basis',async mode=>{
    const intent=createAuthorLengthIntentV1({quantifier:'exact',targetWords:100,basis:'additional-text',source:'control'})
    const f=await fixture(intent)
    await db.worldviews.update(f.worldviewId,{worldOrigin:'原稿'.repeat(2500)})
    const instruction=formatWorldviewFieldGenerationRequestV2({field:'worldOrigin',mode,hint:'只处理当前字段。'})
    const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:instruction,pinnedTask:{
      agentId:'world-origin',skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:intent,instruction,
      promptExecution:{version:1,moduleKey:'worldview.dimension'}}})
    const sent=http(['甲'.repeat(100)]),result=await runMasterWithWorldviewV2({...f,plan})
    const read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(read.root.lengthPlan).toMatchObject({operation:mode,basis:'final-text',mode:'explicit',intent:{basis:'final-text'}})
    expect(read.candidates[0].payload.worldviewFieldV2?.lengthObservation).toMatchObject({measuredWords:100,status:'within'})
    expect(sent.posts).toHaveLength(1)
  },20000)
  it.each(['http','unknown','incomplete','invalid'] as const)('later %s failure retains the complete first draft and restores with zero new POST',async kind=>{
    const f=await fixture(exact(100))
    const failure=kind==='http'?json({error:{message:'synthetic unavailable'}},503):kind==='unknown'?new Error('synthetic socket unavailable')
      :json({choices:[{message:{content:kind==='incomplete'?JSON.stringify({field:'worldOrigin',value:'未完成'}):'{not valid json'},finish_reason:kind==='incomplete'?'length':'stop'}]})
    const sent=http(['甲'.repeat(40),failure]),result=await runMasterWithWorldviewV2(f)
    const read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(sent.posts).toHaveLength(2)
    expect(read.rounds).toHaveLength(1)
    expect(read.candidates[0].payload.worldviewFieldV2).toMatchObject({disposition:'needs-attention',lengthObservation:{measuredWords:40}})
    expect(JSON.parse(read.candidates[0].draft).value).toBe('甲'.repeat(40))
    const artifactsBefore=await db.agentRunArtifacts.toArray()
    await runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,conversationId:f.conversationId,runId:result.runId})
    expect(await db.agentRunArtifacts.toArray()).toEqual(artifactsBefore)
    expect(sent.posts).toHaveLength(2)
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
  },30000)
  it.each(['unknown','invalid'] as const)('after %s and failed best-candidate storage refresh exposes the earlier complete draft without rePOST',async kind=>{
    const failure=kind==='unknown'?new Error('synthetic socket unavailable'):json({choices:[{message:{content:'{not valid json'},finish_reason:'stop'}]})
    const f=await fixture(exact(100)),sent=http(['甲'.repeat(40),failure])
    const original=conversations.appendAgentEvent
    const spy=vi.spyOn(conversations,'appendAgentEvent').mockImplementation(async input=>{
      if(input.kind==='candidate')throw new Error('synthetic best candidate write failure')
      return original(input)
    })
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow('synthetic best candidate write failure')
    spy.mockRestore()
    const run=(await db.agentRuns.toArray())[0]
    const recovered=await runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,conversationId:f.conversationId,runId:run.id!})
    expect(recovered.candidates[0].payload.worldviewFieldV2).toMatchObject({disposition:'needs-attention',lengthObservation:{measuredWords:40}})
    expect(sent.posts).toHaveLength(2)
  },30000)
  it('an explicit exact-Run end preserves unknown originals, rejects stale sequence/foreign scope and permits only a new task POST',async()=>{
    const f=await fixture(),sent=http([])
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow()
    const run=(await db.agentRuns.toArray())[0]
    const endable=await findEndableWorldviewRunV2({scope:f.scope,conversationId:f.conversationId})
    if(!endable)throw new Error('failed ordinary Run must have an explicit end choice')
    const ref={scope:f.scope,conversationId:f.conversationId,worldGroupId:null,...endable}
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow('原会谈仍有未处理运行')
    await expect(endWorldviewMasterRunV2({...ref,conversationId:f.conversationId+1})).rejects.toThrow()
    await expect(endWorldviewMasterRunV2({...ref,scope:{...f.scope,workId:f.scope.workId+1}})).rejects.toThrow()
    await artifacts.recordAgentRunArtifactV1({scope:f.scope,runId:run.id!,artifactKind:'tool-result',content:'额外已登记审计',expectedLastSequence:endable.expectedLastSequence})
    await expect(endWorldviewMasterRunV2(ref)).rejects.toThrow('刷新')
    const latest=await findEndableWorldviewRunV2({scope:f.scope,conversationId:f.conversationId})
    if(!latest)throw new Error('changed interrupted Run must remain explicitly endable')
    const preserved=await db.agentRunArtifacts.toArray()
    const ended=await endWorldviewMasterRunV2({...ref,...latest})
    expect(ended.projection.state).toBe('cancelled')
    expect(await db.agentRunArtifacts.toArray()).toEqual(preserved)
    expect(await findEndableWorldviewRunV2({scope:f.scope,conversationId:f.conversationId})).toBeNull()
    await expect(runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,conversationId:f.conversationId,runId:run.id!})).rejects.toThrow()
    expect(sent.posts).toHaveLength(1)
    const next=http(['作者明确开始的新稿']),fresh=await runMasterWithWorldviewV2(f)
    expect(fresh.runId).not.toBe(run.id)
    expect(next.posts).toHaveLength(1)
  },30000)
  it('end cannot cross a still-owned execution lock or cancel its in-flight POST',async()=>{
    const f=await fixture()
    let release:(()=>void)|undefined,notify:(()=>void)|undefined
    const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{notify=resolve})
    const sent=http(['完整原稿'],async()=>{notify?.();await gate})
    const running=runMasterWithWorldviewV2(f)
    try {
      await started
      const endable=await findEndableWorldviewRunV2({scope:f.scope,conversationId:f.conversationId})
      if(!endable)throw new Error('active Run identity must be readable')
      await expect(endWorldviewMasterRunV2({scope:f.scope,conversationId:f.conversationId,worldGroupId:null,...endable})).rejects.toThrow('另一页面')
      expect((await readAgentRunV1(f.scope,endable.runId)).projection.state).toBe('running')
    } finally {release?.()}
    await running
    expect(sent.posts).toHaveLength(1)
  },20000)

  it('preserves a genuine explicit consumption bound independently of the author word goal',async()=>{
    const f=await fixture(exact(100)),task=f.plan.tasks[0]
    const instruction=task.instruction
    const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:instruction,pinnedTask:{agentId:'world-origin',
      skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:exact(100),instruction,
      promptExecution:{version:1,moduleKey:'worldview.dimension',maxTokens:3}}})
    const sent=http(['甲'.repeat(40),'乙'.repeat(60)]),result=await runMasterWithWorldviewV2({...f,plan})
    const read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(sent.posts.map(body=>JSON.parse(body).max_tokens)).toEqual([3,2])
    expect(read.candidates[0].payload.worldviewFieldV2).toMatchObject({disposition:'needs-attention',lengthObservation:{measuredWords:60}})
    expect(read.candidates[0].payload.worldviewFieldV2?.reason).toContain('明确输出消费约束')
    expect(read.snapshot.contract.budget.allocation?.hardConstraints?.maxOutputTokens).toBe(3)
  },20000)

  it('stops on duplicate/non-improvement and visibly retains the best candidate, no third POST',async()=>{
    const f=await fixture(exact(100)),sent=http(['甲'.repeat(80),'乙'.repeat(70)])
    const result=await runMasterWithWorldviewV2(f),read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(sent.posts).toHaveLength(2);expect(read.rounds).toHaveLength(2)
    expect(read.candidates[0].payload.worldviewFieldV2).toMatchObject({disposition:'needs-attention',lengthObservation:{measuredWords:80}})
    await expect(adoptMasterWithWorldviewV2({scope:f.scope,runId:result.runId,candidateEventId:read.candidates[0].event.id!,worldGroupId:null})).rejects.toThrow('仍需处理')
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('')
  },20000)

  it('recovers complete paid raw after a post-response write failure and active template change with zero new POST',async()=>{
    const f=await fixture(),sent=http(['可恢复完整原稿'])
    const original=artifacts.recordAgentRunArtifactV1
    const spy=vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{
      if(input.artifactKind==='tool-result'&&input.content.startsWith('{\n  "field":'))throw new Error('synthetic draft storage failure')
      return original(input)
    })
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow('synthetic draft storage failure');spy.mockRestore()
    const run=(await db.agentRuns.toArray())[0]
    usePromptStore.setState({templates:[{...template,systemPrompt:'新模板只影响新请求',updatedAt:2}]})
    const recovered=await runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,conversationId:f.conversationId,runId:run.id!})
    const read=await restoreWorldviewFieldMasterV2(f.scope,recovered.runId)
    expect(read.candidates[0].draft).toContain('可恢复完整原稿');expect(sent.posts).toHaveLength(1)
    await adoptMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,runId:run.id!,candidateEventId:read.candidates[0].event.id!})
    expect(sent.posts).toHaveLength(1)
  },20000)

  it('blocks a newly paid revision after template/source change while retaining the original complete short draft',async()=>{
    const f=await fixture(exact(100)),sent=http(['甲'.repeat(40)],()=>{usePromptStore.setState({templates:[{...template,systemPrompt:'new',updatedAt:2}]})})
    const result=await runMasterWithWorldviewV2(f),read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(sent.posts).toHaveLength(1);expect(read.candidates[0].payload.worldviewFieldV2?.disposition).toBe('needs-attention')
    expect(read.candidates[0].payload.worldviewFieldV2?.reason).toContain('模板已变化')
  },20000)

  it('routes author edits through existing conversation save, updates count only, and adopts the explicit author draft without POST',async()=>{
    const f=await fixture(exact(20)),sent=http(['甲'.repeat(20)])
    const result=await runMasterWithWorldviewV2(f),read=await restoreWorldviewFieldMasterV2(f.scope,result.runId),event=read.candidates[0].event
    await updateAgentEventCandidate(event.id!,f.scope.projectId,JSON.stringify({field:'worldOrigin',value:'作者手改稿'}),f.scope)
    const edited=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    expect(edited.candidates[0].payload.worldviewFieldV2).toMatchObject({disposition:'author-edited',lengthObservation:{measuredWords:5,status:'short'}})
    expect(edited.state.roundRefs).toEqual(read.state.roundRefs)
    await adoptMasterWithWorldviewV2({scope:f.scope,runId:result.runId,candidateEventId:event.id!,worldGroupId:null})
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('作者手改稿');expect(sent.posts).toHaveLength(1)
  },20000)

  it('unknown/failed inference never causes an automatic or resume POST',async()=>{
    const f=await fixture(),sent=http([])
    await expect(runMasterWithWorldviewV2(f)).rejects.toThrow()
    const run=(await db.agentRuns.toArray())[0]
    await expect(runMasterWithWorldviewV2({scope:f.scope,worldGroupId:null,runId:run.id!,conversationId:f.conversationId})).rejects.toThrow()
    expect(sent.posts).toHaveLength(1)
  },20000)

  it('rejects target drift, wrong native types/unknown fields, and same-Run fake wire rather than accepting available hashes',async()=>{
    expect(()=>parseWorldviewFieldCandidateDraftV2(JSON.stringify({field:'divineDesign',value:{hasDivinity:'yes',divineRank:'x',divineNames:'y',divineRules:'z'}}))).toThrow()
    expect(()=>parseWorldviewFieldCandidateDraftV2(JSON.stringify({field:'worldOrigin',value:'合法内容',other:'extra'}))).toThrow()
    const f=await fixture(),sent=http(['真实调用原稿']),result=await runMasterWithWorldviewV2(f),read=await restoreWorldviewFieldMasterV2(f.scope,result.runId)
    await expect(updateAgentEventCandidate(read.candidates[0].event.id!,f.scope.projectId,JSON.stringify({field:'races',value:'错误目标'}),f.scope)).rejects.toThrow('其他字段')
    const round=structuredClone(read.rounds[0])
    const forged=await artifacts.recordAgentRunArtifactV1({scope:f.scope,runId:result.runId,expectedLastSequence:read.snapshot.projection.lastSequence,
      artifactKind:'rendered-request',content:canonicalStringify({...read.wire,messages:[{role:'user',content:'同Run伪造其他提示词'}]})})
    round.wireRef={artifactKind:'rendered-request',contentHash:forged.artifact.contentHash,byteLength:forged.artifact.byteLength}
    const roundSaved=await artifacts.recordAgentRunArtifactV1({scope:f.scope,runId:result.runId,expectedLastSequence:forged.snapshot.projection.lastSequence,
      artifactKind:'tool-result',content:canonicalStringify(round)})
    await expect(inspectWorldviewRoundV2({scope:f.scope,runId:result.runId,roundRef:{artifactKind:'tool-result',contentHash:roundSaved.artifact.contentHash,
      byteLength:roundSaved.artifact.byteLength}})).rejects.toThrow('wire')
    expect(sent.posts).toHaveLength(1)
  },20000)

  it.each(['pending','completed'] as const)('imports %s history read-only even when clean-DB numeric owner/Run IDs are identical; only an explicit new start can pay',async state=>{
    const f=await fixture(),sent=http(['原始付费完整稿','导入后作者明确开始的新稿'])
    const generated=await runMasterWithWorldviewV2(f),before=await restoreWorldviewFieldMasterV2(f.scope,generated.runId)
    if(state==='completed') {
      await adoptMasterWithWorldviewV2({scope:f.scope,runId:generated.runId,candidateEventId:before.candidates[0].event.id!,worldGroupId:null})
      await verifyMasterWithWorldviewV2({scope:f.scope,runId:generated.runId})
    }
    const bodyBefore=(await db.agentRunArtifacts.toArray()).map(row=>[row.artifactKind,row.contentHash,row.content]).sort((a,b)=>String(a[1]).localeCompare(String(b[1])))
    const exported=await exportProjectJSON(f.scope.projectId)
    await db.delete();await db.open()
    const imported=await importProjectJSON(exported),project=(await db.projects.get(imported))!
    const scope={projectId:imported,worldId:project.activeWorldId!,workId:project.activeWorkId!}
    // This is the security regression: all numeric IDs really collide, rather
    // than obtaining rejection from a coincidental owner/hash mismatch.
    expect(scope).toEqual(f.scope)
    const run=(await db.agentRuns.toArray())[0];expect(run.id).toBe(generated.runId)
    const events=await db.agentEvents.toArray(),candidate=events.find(row=>row.kind==='candidate')!
    const committedBefore={runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray(),artifacts:await db.agentRunArtifacts.toArray(),
      candidates:events,checkpoints:await db.agentRunCheckpoints.toArray()}
    expect((await db.agentRunArtifacts.toArray()).map(row=>[row.artifactKind,row.contentHash,row.content]).sort((a,b)=>String(a[1]).localeCompare(String(b[1])))).toEqual(bodyBefore)
    await expect(runMasterWithWorldviewV2({scope,worldGroupId:null,conversationId:run.conversationId!,runId:run.id!})).rejects.toThrow('历史只读')
    await expect(adoptMasterWithWorldviewV2({scope,worldGroupId:null,runId:run.id!,candidateEventId:candidate.id!})).rejects.toThrow('历史只读')
    await expect(verifyMasterWithWorldviewV2({scope,runId:run.id!})).rejects.toThrow('历史只读')
    const importedSnapshot=await readAgentRunV1(scope,run.id!)
    await expect(endWorldviewMasterRunV2({scope,runId:run.id!,conversationId:run.conversationId!,worldGroupId:null,expectedLastSequence:importedSnapshot.projection.lastSequence})).rejects.toThrow('历史只读')
    expect(await findEndableWorldviewRunV2({scope,conversationId:run.conversationId!})).toBeNull()
    await expect(updateAgentEventCandidate(candidate.id!,scope.projectId,JSON.stringify({field:'worldOrigin',value:'不能借重号改旧运行'}),scope)).rejects.toThrow('历史只读')
    const display=await projectWorldviewImportedHistoryV2(scope,events)
    expect(display.find(row=>row.id===candidate.id)?.kind).toBe('message')
    expect(display.find(row=>row.id===candidate.id)?.content).toContain('原始付费完整稿')
    expect({runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray(),artifacts:await db.agentRunArtifacts.toArray(),
      candidates:await db.agentEvents.toArray(),checkpoints:await db.agentRunCheckpoints.toArray()}).toEqual(committedBefore)
    expect(sent.posts).toHaveLength(1)
    const instruction=formatWorldviewFieldGenerationRequestV1({field:'worldOrigin',mode:'rewrite',hint:'这是导入后作者明确开始的新任务。'})
    const plan=await createMasterAgentPlan({projectId:scope.projectId,scope,worldGroupId:null,request:instruction,pinnedTask:{agentId:'world-origin',
      skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:null,instruction,promptExecution:{version:1,moduleKey:'worldview.dimension'}}})
    const fresh=await runMasterWithWorldviewV2({scope,worldGroupId:null,conversationId:run.conversationId!,plan})
    expect(fresh.runId).not.toBe(run.id);expect(sent.posts).toHaveLength(2)
  },30000)

  it('freezes host intent|null strictly and applies actual field kinds/operation, not a template default',async()=>{
    const f=await fixture(),task=await parseWorldviewFieldTaskV2(f.plan.tasks[0]),readTemplate=task.worldviewFieldPromptV2
    await expect(parseWorldviewFieldTaskV2({...task,authorLengthIntent:undefined})).rejects.toThrow()
    await expect(parseWorldviewFieldTaskV2({...task,extra:true})).rejects.toThrow()
    expect(()=>parseAuthorLengthIntentV1({...exact(100),unknown:1})).toThrow()
    const snapshot=(await import('../../src/lib/agent/worldview-field-copilot')).readWorldviewFieldSnapshotV2
    const baseline=await snapshot(f.scope.projectId,null,f.scope)
    expect(resolveWorldviewLengthPlanV2({...task,targetField:'worldDimensions'},baseline,'create')).toMatchObject({taskKind:'short-field',mode:'automatic',referenceWords:null})
    const resources=resolveWorldviewLengthPlanV2({...task,targetField:'naturalResources',worldviewFieldPromptV2:readTemplate},baseline,'create')
    expect(resources).toMatchObject({taskKind:'setting-set',referenceWords:null,components:expect.any(Array)})
    if(resources.mode==='automatic')expect(resources.components).toHaveLength(4)
    expect(resolveWorldviewLengthPlanV2(task,baseline,'polish')).toMatchObject({operation:'polish',referenceWords:null})
  })
})
