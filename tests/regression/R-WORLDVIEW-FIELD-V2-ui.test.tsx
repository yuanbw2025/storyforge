import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import WorldviewAgentControls from '../../src/components/worldview/WorldviewAgentControls'
import WorldviewFieldCandidateReview from '../../src/components/worldview/WorldviewFieldCandidateReview'
import { resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { observeAuthorLengthV1 } from '../../src/lib/ai/author-length-revision'
import type { MasterCopilotController, PendingMasterCandidate } from '../../src/components/agent/useMasterCopilot'
import type { Project } from '../../src/lib/types'

// UI contract tests only. Durable ownership/actual-wire/adoption are exercised
// independently by R-WORLDVIEW-FIELD-V2; this read stub does not prove them.
const baseline=vi.hoisted(()=>({values:{worldOrigin:'旧稿'},id:1,ragDocumentId:null,updatedAt:1,serialized:'fixture',foundationState:'partial'}))
vi.mock('../../src/lib/agent/run/worldview-field-v2-durable',()=>({restoreWorldviewFieldMasterV2:vi.fn(async()=>({baseline}))}))
vi.mock('../../src/components/shared/PromptRunPanel',()=>({default:()=>null}))
vi.mock('../../src/components/agent/HarnessEvidencePanel',()=>({default:()=>null}))
vi.mock('../../src/components/agent/CopilotGenerationStatus',()=>({default:()=>null}))

const reactActGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function render(node: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(node))
  return { rerender: async (next: ReactNode) => { await act(async () => root.render(next)) } }
}
async function cleanup() {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
}
function control<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error('Missing control: ' + selector)
  return found
}
function button(name: string) {
  const found = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === name)
  if (!found) throw new Error('Missing button: ' + name)
  return found
}
async function click(name: string) { await act(async () => button(name).click()) }
async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const waitFor = vi.waitFor

afterEach(cleanup)
function controller() {
  return {submitTargetedRequest:vi.fn(async()=>undefined),pendingCandidates:[],loading:false,busy:false,error:null,
    activeTaskLengthPlan:null,activeLengthProgress:null,readVisibleCandidateDraft:()=>undefined,stop:vi.fn()} as unknown as MasterCopilotController
}
async function controls(copilot:MasterCopilotController) {
  await render(<WorldviewAgentControls field="worldOrigin" project={{id:1,enableMultiWorld:false} as Project} activeGroupId={null}
    copilot={copilot} hasOtherPendingCandidates={false} onRunningChange={()=>undefined} onAdopted={async()=>undefined} />)
}
describe('B02 actual ordinary controls and candidate edit UI',()=>{
  it('emits the strict exact V2 task with host automatic null, not old output tokens',async()=>{
    const copilot=controller();await controls(copilot)
    expect(control<HTMLSelectElement>('[aria-label="篇幅安排"]').value).toBe('automatic')
    await click('AI 生成')
    await waitFor(()=>expect(copilot.submitTargetedRequest).toHaveBeenCalledOnce())
    const pinned=vi.mocked(copilot.submitTargetedRequest).mock.calls[0][1]
    expect(pinned).toMatchObject({agentId:'world-origin',skillId:'world-origin.worldview-field.v2',targetField:'worldOrigin',authorLengthIntent:null})
    expect(pinned.promptExecution).not.toHaveProperty('maxTokens')
    expect(document.querySelector('[aria-label="世界基座自定义输出 tokens"]')).toBeNull()
  })
  it('passes author approximate target and visible range without a program max',async()=>{
    const copilot=controller();await controls(copilot)
    await setValue(control<HTMLInputElement | HTMLSelectElement>('[aria-label="篇幅安排"]'),'approximate')
    await setValue(control<HTMLInputElement | HTMLSelectElement>('[aria-label="目标字数"]'),'10000')
    await click('AI 生成')
    await waitFor(()=>expect(copilot.submitTargetedRequest).toHaveBeenCalledOnce())
    expect(vi.mocked(copilot.submitTargetedRequest).mock.calls[0][1].authorLengthIntent).toMatchObject({source:'control',targetWords:10000,acceptance:{minWords:8000,maxWords:12000}})
    expect(control<HTMLInputElement>('[aria-label="目标字数"]').hasAttribute('max')).toBe(false)
  })
  it.each(['重写','润色'])('扩写改为%s后不保留隐藏的净新增目标',async mode=>{
    const copilot=controller();await controls(copilot)
    await setValue(control<HTMLInputElement | HTMLSelectElement>('[aria-label="篇幅安排"]'),'exact')
    await setValue(control<HTMLInputElement | HTMLSelectElement>('[aria-label="目标字数"]'),'1000')
    const basis=control<HTMLInputElement | HTMLSelectElement>('[aria-label="篇幅计数范围"]')
    await setValue(basis,'final-text')
    await setValue(basis,'additional-text')
    await click(mode)
    expect(document.querySelector('[aria-label="篇幅计数范围"]')).toBeNull()
    await click('AI 生成')
    await waitFor(()=>expect(copilot.submitTargetedRequest).toHaveBeenCalledOnce())
    expect(vi.mocked(copilot.submitTargetedRequest).mock.calls[0][1].authorLengthIntent).toMatchObject({targetWords:1000,basis:'final-text'})
  })
  it('长作者补充要求完整交给准确V2 host task，尾部不经过旧8000门',async()=>{
    const copilot=controller();await controls(copilot)
    const hint='完整设定资料。'.repeat(1600)+'末尾硬约束：潮门永远只能向海开启。'
    await setValue(control<HTMLInputElement | HTMLTextAreaElement>('[placeholder="给 AI 的补充说明（可选）"]'),hint)
    await click('AI 生成')
    await waitFor(()=>expect(copilot.submitTargetedRequest).toHaveBeenCalledOnce())
    const [request,pinned]=vi.mocked(copilot.submitTargetedRequest).mock.calls[0]
    expect(request.length).toBeGreaterThan(8000)
    expect(request).toContain(hint)
    expect(pinned.instruction).toBe(request)
    expect(pinned.skillId).toBe('world-origin.worldview-field.v2')
  })
  it('失败空任务有明确结束入口，界面忙碌时不提供跨页取消捷径',async()=>{
    const copilot=controller()
    copilot.endableWorldviewRun={runId:42,expectedLastSequence:17}
    copilot.endInterruptedWorldviewRun=vi.fn(async()=>undefined)
    await controls(copilot)
    expect(document.body.textContent).toMatch(/未完成任务 #42/)
    await click('结束此未完成任务')
    await waitFor(()=>expect(copilot.endInterruptedWorldviewRun).toHaveBeenCalledOnce())
    await cleanup();copilot.busy=true;await controls(copilot)
    expect(Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === '结束此未完成任务') ?? null).toBeNull()
  })
  it('renders actual backend preflight plan and revision progress rather than a guessed UI operation',async()=>{
    const copilot=controller()
    copilot.activeTaskLengthPlan=resolveTaskLengthPlanV1({taskKind:'setting-field',operation:'create',intent:null})
    copilot.activeLengthProgress={rounds:3,words:5700,status:'revise-length'}
    await controls(copilot)
    expect(document.body.textContent).toMatch(/4000/)
    expect(document.body.textContent).toMatch(/已保存 3 轮完整稿/)
    expect(document.body.textContent).toMatch(/正在按原要求调整字数/)
  })
  it('uses V2 parser for long candidate edit and counts values only, keeping the frozen original comparison',async()=>{
    const plan=resolveTaskLengthPlanV1({taskKind:'setting-field',operation:'create',intent:null})
    const value='长稿'.repeat(8000)+'编辑尾标',draft=JSON.stringify({field:'worldOrigin',value})
    const observation=observeAuthorLengthV1({plan,text:value,representation:'plain-text',candidateKind:'complete-replacement',baseline:{text:'旧稿',representation:'plain-text'}})
    const ref={artifactKind:'tool-result' as const,contentHash:'a'.repeat(64),byteLength:1}
    const candidate={event:{id:1,content:draft},payload:{version:1,taskId:'target',agentId:'world-origin',skillId:'world-origin.worldview-field.v2',label:'世界来源',
      contextSources:[],baseSnapshot:{},worldviewField:'worldOrigin',worldviewFieldOperation:'create',runId:1,workspaceScope:{projectId:1,worldId:1,workId:1},
      worldviewFieldV2:{version:'worldview-field-candidate-v2',rootRef:ref,draftRef:ref,roundRefs:[],lengthPlan:plan,lengthObservation:observation,disposition:'ready',reason:'字数自动'}}} as unknown as PendingMasterCandidate
    const update=vi.fn(),invalid=vi.fn()
    const view=await render(<WorldviewFieldCandidateReview candidate={candidate} busy={false} onUpdate={update} onInvalidEdit={invalid} />)
    await waitFor(()=>expect(document.body.textContent).toMatch(/当前全文 16004 字/))
    const editor=control<HTMLTextAreaElement>('[aria-label="世界来源候选内容"]')
    expect(editor.value).toBe(value)
    const edited=value+'手改尾标';await setValue(editor,edited)
    expect(invalid).not.toHaveBeenCalled();expect(update.mock.calls[0][0]).toContain('手改尾标')
    await view.rerender(<WorldviewFieldCandidateReview candidate={{...candidate,event:{...candidate.event,content:update.mock.calls[0][0]}}} busy={false} onUpdate={update} onInvalidEdit={invalid} />)
    await waitFor(()=>expect(document.body.textContent).toMatch(/当前全文 16008 字/))
    expect(document.body.textContent).toMatch(/自动参考，不设最高字数/)
  })
})
