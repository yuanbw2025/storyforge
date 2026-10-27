import { configureManualDiscoveryDirectionsV1 } from '../helpers/open-ttrpg-manual'
import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,changeTtrpgSituationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as table from '../../src/lib/ttrpg/open-table-service'
import TtrpgOpenIntentReview from '../../src/components/ttrpg/TtrpgOpenIntentReview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN3 original intent review and explicit human clarification', { timeout: 60000 },() => {
  let host: HTMLDivElement,root: Root
  beforeEach(async () => { await db.delete();await db.open();host = document.createElement('div');document.body.append(host);root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount());host.remove();db.close();vi.restoreAllMocks() })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
  async function until(check: () => boolean) {
    for (let i = 0;i < 600;i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve,10)) });if (check()) return }
    throw Error(`clarification view did not settle: ${host.textContent?.slice(0,1500)}`)
  }
  async function text(label: string,value: string) {
    await act(async () => {
      const row = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(row,value);row.dispatchEvent(new Event('input',{ bubbles: true }))
    })
  }
  async function choose(label: string,predicate: (option: HTMLOptionElement) => boolean) {
    await act(async () => {
      const row = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
      row.value = [...row.options].find(predicate)!.value;row.dispatchEvent(new Event('change',{ bubbles: true }))
    })
  }
  async function setup(bindingKind?: 'rule' | 'discovery' | 'legacy-discovery') {
    const f = await readyOpenTtrpgSessionV1('clarification user controls',p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
      if (bindingKind === 'legacy-discovery') configureManualDiscoveryDirectionsV1(p)
      if (bindingKind === 'rule') {
        p.ttrpg!.campaign.effectPlanTemplates[0].parameters = [];p.ttrpg!.campaign.effectPlanTemplates[0].effects[0].targetRef = 'hero'
      }
      if (bindingKind === 'discovery') {
        p.ttrpg!.campaign.effectPlanTemplates.push({ planKey: 'plan.empty.discovery',degree: 'failure',ruleRef: p.ttrpg!.rulePack.content.ruleSystemId,
          reason: '固定的调查消耗',audience: 'party',parameters: [],effects: [{ effectKey: 'fixed.cost',family: 'numeric',operation: 'resource.spend',targetRef: 'hero',valueKey: p.ttrpg!.rulePack.content.resources[0].key,amount: 1 }],alternatives: [] })
        p.ttrpg!.campaign.situationTemplates[0].evidence[0].discoveryPolicy.costEffectPlanRef = 'plan.empty.discovery'
      }
    })
    if (bindingKind === 'legacy-discovery') for (const templateKey of f.campaign.openingSituationKeys) await changeTtrpgSituationV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ui.opening.'+templateKey),templateKey,activationReason: 'opening',mode: 'activated' })
    if (bindingKind === 'discovery') await changeTtrpgSituationV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ui.opening'),templateKey: f.campaign.openingSituationKeys[0],activationReason: 'opening',mode: 'activated' })
    const rawInput = '先提供掩护，具体方法和对象需要补充'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ui.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'submit-action',rawInput })
    const runAI = vi.fn(async () => JSON.stringify({ goal: '原始建议待澄清',method: null,targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }))
    const g = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ui.generate'),scope: f.scope,actorKey: 'hero',viewerKey: OPEN_HUMAN_VIEWER,
      rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI })
    const input = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER }
    let sequence = (await readProductRuntimeState(f.sessionId)).lastSequence
    const errors: unknown[] = []
    const render = async () => root.render(createElement(TtrpgOpenIntentReview,{ input,sequence,candidate: g.candidate,busy: false,perform }))
    const perform = vi.fn(async (job: () => Promise<void>) => {
      try { await job();sequence = (await readProductRuntimeState(f.sessionId)).lastSequence;await render() } catch (error) { errors.push(error);throw error }
    })
    return { f,g,input,runAI,render,perform,errors }
  }
  it('requires a saved clarification before confirmation, shows the reviewed rule and admits exactly that version once',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    const save = vi.spyOn(table,'clarifyTtrpgOpenTableCandidateV2'),accept = vi.spyOn(table,'acceptTtrpgOpenTableCandidateV1')
    await act(x.render);await until(() => !!host.querySelector('fieldset[aria-label="补充行动意图"]'))
    expect(button('确认这份行动意图')).toBeUndefined()
    await text('补充后的行动说明','改为独立观察公开情况');await text('补充后的期望结果','获取可复核的调查结果')
    await choose('补充行动规则',o => o.value.includes('investigate'))
    await act(async () => { button('保存补充并重新核对')!.click();button('保存补充并重新核对')!.click() })
    await until(() => !!button('确认这份行动意图'))
    expect(save).toHaveBeenCalledOnce();expect(x.runAI).toHaveBeenCalledOnce();expect(x.errors).toEqual([])
    const summary = host.querySelector('[aria-label="已保存的人工澄清"]')!.textContent!
    expect(summary).toContain('改为独立观察公开情况');expect(summary).toContain('当前地点');expect(summary).toContain('获取可复核的调查结果')
    const state = await readProductRuntimeState(x.f.sessionId),record = state.ttrpg!.openRun!.coordination.calls[0].intentClarifications![0]
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.operations).toEqual([])
    await act(async () => { button('继续补充或修改')!.click() });expect(button('确认这份行动意图')).toBeUndefined()
    await act(async () => { button('取消本次编辑，保留已保存的补充')!.click() })
    await act(async () => { button('确认这份行动意图')!.click();button('确认这份行动意图')!.click() })
    await until(() => accept.mock.calls.length === 1 && x.perform.mock.results.every(r => r.type !== 'incomplete'))
    await until(() => host.textContent!.includes('原行动候选') || host.textContent!.includes('窗口已变化'))
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ candidateHash: x.g.candidate.candidateHash,clarificationHash: record.clarificationHash }))
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(after.ttrpg!.openRun!.operations).toHaveLength(1);expect(after.ttrpg!.openRun!.operations[0].status).toBe('awaiting-approval')
    expect(after.entities).toEqual(before.entities);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('retains entered choices after a storage rejection and allows an explicit retry without a hidden model request',async () => {
    const x = await setup(),actual = table.clarifyTtrpgOpenTableCandidateV2
    const save = vi.spyOn(table,'clarifyTtrpgOpenTableCandidateV2').mockRejectedValueOnce(Error('本次保存失败，请保留输入重试')).mockImplementation(actual)
    await act(x.render);await until(() => !!button('保存补充并重新核对'))
    await text('补充后的行动说明','只观察公开情况');await choose('补充行动规则',o => o.value.includes('investigate'))
    await act(async () => { button('保存补充并重新核对')!.click() });await until(() => host.textContent!.includes('本次保存失败'))
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充后的行动说明"]')!.value).toBe('只观察公开情况')
    expect((await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].intentClarifications).toBeUndefined()
    await act(async () => { button('保存补充并重新核对')!.click() });await until(() => !!button('确认这份行动意图'))
    expect(save).toHaveBeenCalledTimes(2);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('keeps an explicitly selected generic check when the unchanged goal mentions investigation',async () => {
    const x = await setup('rule'),before = await readProductRuntimeState(x.f.sessionId)
    await act(x.render);await until(() => !!button('保存补充并重新核对'))
    const goal = '调查公开线索时先核对自己的状态，不预设成功'
    await text('补充后的行动说明',goal)
    await choose('补充行动规则',o => o.value.includes('generic-check'))
    await act(async () => { button('保存补充并重新核对')!.click() });await until(() => !!button('确认这份行动意图'))
    const saved = await readProductRuntimeState(x.f.sessionId),call = saved.ttrpg!.openRun!.coordination.calls[0],record = call.intentClarifications![0]
    expect(record).toMatchObject({ version: 2,selection: { goal },request: { route: 'generic-check',effectBindings: { 'plan.success': {} } } })
    expect(saved.entities).toEqual(before.entities);expect(saved.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    await act(async () => { button('确认这份行动意图')!.click() })
    await until(() => x.errors.length > 0 || host.textContent!.includes('原行动候选') || host.textContent!.includes('窗口已变化'))
    expect(x.errors).toEqual([])
    const op = (await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.operations[0]
    expect(op.plan.request).toEqual(record.request);expect(op.intentEvidence?.routingVersion).toBe(2)
    expect(x.g.candidate.intent?.method).toBeNull();expect(x.runAI).toHaveBeenCalledOnce()
  })
  it.each(['rule','discovery'] as const)('preserves frozen %s templates with an empty parameter binding in the actual saved request',async bindingKind => {
    const x = await setup(bindingKind),save = vi.spyOn(table,'clarifyTtrpgOpenTableCandidateV2'),before = await readProductRuntimeState(x.f.sessionId)
    await act(x.render);await until(() => !!button('保存补充并重新核对'))
    await text('补充后的行动说明','以已经确认的方法尝试取得可复核的结果')
    await choose('补充行动规则',o => o.value.includes(bindingKind === 'rule' ? 'generic-check' : 'investigate'))
    if (bindingKind === 'discovery') await choose('补充检查线索',o => o.value !== '')
    await act(async () => { button('保存补充并重新核对')!.click() });await until(() => !!button('确认这份行动意图'))
    const bindings = bindingKind === 'rule' ? { 'plan.success': {} } : { 'plan.empty.discovery': {} }
    expect(save).toHaveBeenCalledWith(expect.objectContaining(bindingKind === 'rule' ? { effectBindings: bindings } : { discovery: expect.objectContaining({ effectBindings: bindings }) }))
    const state = await readProductRuntimeState(x.f.sessionId),request = state.ttrpg!.openRun!.coordination.calls[0].intentClarifications![0].request!
    expect(bindingKind === 'rule' ? request.effectBindings : request.discovery!.effectBindings).toEqual(bindings)
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('clears the previous identity immediately and ignores an old read completed after handoff',async () => {
    const x = await setup(),review = await table.readTtrpgOpenTableIntentReviewV2({ ...x.input,runId: x.g.candidate.runId,requestKey: x.g.candidate.requestKey,candidateHash: x.g.candidate.candidateHash })
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const read = vi.spyOn(table,'readTtrpgOpenTableIntentReviewV2').mockImplementationOnce(async () => { await hold;return { ...review,message: 'OLD-REVIEW-PRIVATE-SENTINEL' } })
    await act(x.render);await until(() => read.mock.calls.length === 1)
    await act(async () => root.render(createElement(TtrpgOpenIntentReview,{ input: { ...x.input,viewerKey: 'viewer.other' },sequence: 0,candidate: x.g.candidate,busy: false,perform: x.perform })))
    expect(host.textContent).not.toContain('原始建议待澄清');expect(host.querySelector('textarea')).toBeNull()
    await act(async () => { release();await hold;await Promise.resolve() })
    expect(host.textContent).not.toContain('OLD-REVIEW-PRIVATE-SENTINEL');expect(read).toHaveBeenCalledOnce();expect(x.perform).not.toHaveBeenCalled()
  })
  it('blocks a stale or forged unavailable discovery selection and saves the available direction through the same original clarification',async () => {
    const x = await setup('legacy-discovery'),save = vi.spyOn(table,'clarifyTtrpgOpenTableCandidateV2'),before = await readProductRuntimeState(x.f.sessionId)
    await act(x.render);await until(() => !!button('保存补充并重新核对'))
    await text('补充后的行动说明','只检查公开方向，保留本人风险和实际发现代价')
    await choose('补充行动规则',o => o.value.includes('investigate'))
    const paths = host.querySelector<HTMLSelectElement>('select[aria-label="补充检查线索"]')!
    expect([...paths.options].find(o => o.value.includes('direction.legacy'))!.disabled).toBe(true)
    // Programmatic input can bypass a native disabled option; it still must not save or silently drop discovery.
    await choose('补充检查线索',o => o.value.includes('direction.legacy'))
    expect(button('保存补充并重新核对')!.disabled).toBe(true)
    await act(async () => button('保存补充并重新核对')!.click())
    expect(save).not.toHaveBeenCalled();expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await choose('补充检查线索',o => o.value.includes('direction.current'))
    expect(button('保存补充并重新核对')!.disabled).toBe(false)
    await act(async () => button('保存补充并重新核对')!.click());await until(() => !!button('确认这份行动意图'))
    expect(save).toHaveBeenCalledOnce();expect(x.runAI).toHaveBeenCalledOnce()
    const state = await readProductRuntimeState(x.f.sessionId)
    expect(state.ttrpg!.openRun!.coordination.calls[0].intentClarifications![0].request!.discovery!.evidenceRef).toBe('direction.current.evidence.1')
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })

})
