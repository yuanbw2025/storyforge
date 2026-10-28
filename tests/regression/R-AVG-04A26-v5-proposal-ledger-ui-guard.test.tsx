import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import VisualPlanningPanel from '../../src/components/avg/VisualPlanningPanel'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { stageAvgVisualPlanningAuthorInputV5 } from '../../src/lib/avg/visual-planning-workspace'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5RegisteredProposalsFixture,adoptAvgV5Sources,cycleAvgV5Until } from '../helpers/avg-v5-registered-proposals-fixture'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let mounted:Root|undefined

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
})
afterEach(async()=>{
  if(mounted)await act(async()=>mounted!.unmount())
  mounted=undefined;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();db.close()
})

describe('AVG V5 proposal author-action settlement gate',()=>{
  it('keeps author edits and staging disabled until the accepted proposal producer ledger settles',async()=>{
    const s=await avgV5RegisteredProposalsFixture()
    await adoptAvgV5Sources(s);await cycleAvgV5Until(s,'avg.proposal.visual-bible')
    const view=await readAvgAssemblyWorkspaceV1(s.scope),build=view.details!.build!
    const ledger=JSON.parse(build.budgetLedgerJson) as {tasks:Record<string,{status:string;candidateHash:string|null;terminalReceiptHash:string|null}>}
    const producer=s.plan.tasks.find(task=>task.outputArtifactKeys.includes('avg.proposal.visual-bible'))!
    ledger.tasks[producer.taskKey]={...ledger.tasks[producer.taskKey]!,status:'claimed',candidateHash:null,terminalReceiptHash:null}
    const projected={...view,details:{...view.details!,build:{...build,budgetLedgerJson:JSON.stringify(ledger)}}}
    const container=document.createElement('div');document.body.appendChild(container);mounted=createRoot(container)
    const action=vi.fn(),generate=vi.fn(async()=>{}),noop=vi.fn(),pending=vi.fn()
    await act(async()=>mounted!.render(<VisualPlanningPanel scope={s.scope} view={projected} workspace={s.author.source} disabled={false}
      visible={true} activeBuild={true} sourcesReady={true} declaration="工程验证" generating={false} onAction={action} onPrepare={noop}
      onGenerate={generate} onCancel={noop} onReload={vi.fn()} onNotice={noop} onPending={pending}/>))

    const save=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes('保存待确认：视觉基准'))
    const recovery=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='继续或恢复本批任务')
    expect(container.textContent).toContain('producer ledger 尚未完成结算')
    expect(save).toBeDefined();expect(save!.closest('fieldset')?.disabled).toBe(true)
    expect(recovery).toBeDefined();expect(recovery!.disabled).toBe(false)
    await act(async()=>recovery!.click())
    expect(generate).toHaveBeenCalledTimes(1)
    await act(async()=>mounted!.render(<VisualPlanningPanel scope={s.scope} view={projected} workspace={s.author.source} disabled={false}
      visible={true} activeBuild={true} sourcesReady={true} declaration="工程验证" generating={true} onAction={action} onPrepare={noop}
      onGenerate={generate} onCancel={noop} onReload={vi.fn()} onNotice={noop} onPending={pending}/>))
    const busyRecovery=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='继续或恢复本批任务')
    expect(busyRecovery?.disabled).toBe(true);expect(generate).toHaveBeenCalledTimes(1)
    expect(action).not.toHaveBeenCalled();expect(s.imageCalls).toHaveLength(0)
  },60_000)

  it('recovers a completed V5 proposal producer from its durable checkpoint without another provider call',async()=>{
    const s=await avgV5RegisteredProposalsFixture()
    await adoptAvgV5Sources(s);await cycleAvgV5Until(s,'avg.proposal.visual-bible')
    const proposal=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.proposal.visual-bible']).filter(row=>row.status==='accepted').first())!
    const build=(await db.productBuilds.get(s.buildId))!,task=s.plan.tasks.find(row=>row.outputArtifactKeys.includes(proposal.artifactKey))!
    const ledger=JSON.parse(build.budgetLedgerJson) as {tasks:Record<string,Record<string,unknown>>}
    const settled=ledger.tasks[task.taskKey]
    expect(settled.status).toBe('settled')
    ledger.tasks[task.taskKey]={...settled,attempt:0,status:'claimed',idempotencyKey:'',candidateHash:null,terminalReceiptHash:null,passedGateIds:[],
      usage:{modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:0,storageBytes:0},errorCode:null}
    await db.productBuilds.update(build.id!,{budgetLedgerJson:canonicalProductProductionJsonV2(ledger)})

    await runProductProductionSchedulerCycleV1(s)

    const recovered=(await db.productBuilds.get(s.buildId))!,recoveredLedger=JSON.parse(recovered.budgetLedgerJson) as {tasks:Record<string,Record<string,unknown>>}
    expect(recoveredLedger.tasks[task.taskKey]).toMatchObject({status:'settled',runId:settled.runId,attempt:settled.attempt,
      candidateHash:settled.candidateHash,terminalReceiptHash:settled.terminalReceiptHash})
    expect(s.calls).toHaveLength(1);expect(s.imageCalls).toHaveLength(0)
    const authorCandidate=await stageAvgVisualPlanningAuthorInputV5({scope:s.scope,productionId:s.productionId,expectedBuildId:s.buildId,
      expectedBuildRevision:recovered.stateRevision,artifactKey:'avg.media.visual-bible',
      proposal:{artifactKey:proposal.artifactKey,version:proposal.version,contentHash:proposal.contentHash},
      payload:JSON.parse(proposal.payloadJson).payload,declaration:'作者候选待确认；仅验证producer恢复，不代表美术质量'})
    expect(authorCandidate.status).toBe('pending')
  },60_000)
})
