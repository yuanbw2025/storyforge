import { describe, expect, it } from 'vitest'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { parseAvgVisualPlanningBriefV4 } from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningTargetKeysV4,type AvgVisualProposalReuseSourceV4 } from '../../src/lib/avg/visual-planning-reuse-contract'
import { buildAvgVisualPlanningPlanV4 } from '../../src/lib/avg/visual-planning-plan'
import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from '../../src/lib/avg/visual-planning-policy'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'

const h='a'.repeat(64)
function source(artifactKey:string):AvgVisualProposalReuseSourceV4{return {schema:'storyforge.avg.visual-proposal-reuse-source',version:1,
  productionKey:'portable.production',buildNumber:1,buildRevision:12,controlEpoch:0,briefHash:h,planHash:h,
  artifact:{artifactKey,version:1,contentHash:h},authorReceiptHash:h,proposal:{artifactKey:artifactKey.replace(/^avg\.media\./,'avg.proposal.'),version:1,contentHash:h},
  producerReceiptHash:h,requestSnapshotHash:h,rawResponseHash:h}}

describe('AVG portable proposal reuse contract and zero-call topology',()=>{
  it('preserves legacy V4 bytes and freezes no implicit history selection',async()=>{
    const {planning}=await avgVisualPlanningFixtureV4()
    expect(parseAvgVisualPlanningBriefV4(planning)).toEqual(planning)
    expect(Object.hasOwn(parseAvgVisualPlanningBriefV4(planning),'proposalReuse')).toBe(false)
  })
  it.each(['empty','undefined','duplicate','unowned-target','raw-target','unknown-field','fraction','max-safe','host-id'] as const)('rejects %s rather than granting reuse from partial locators',async mode=>{
    const {planning}=await avgVisualPlanningFixtureV4(),value:Record<string,unknown>={...planning,proposalReuse:[source('avg.media.visual-bible')]}
    const item=(value.proposalReuse as AvgVisualProposalReuseSourceV4[])[0]
    if(mode==='empty')value.proposalReuse=[]
    if(mode==='undefined')value.proposalReuse=undefined
    if(mode==='duplicate')value.proposalReuse=[item,item]
    if(mode==='unowned-target')value.proposalReuse=[source('avg.media.environment-brief.outside')]
    if(mode==='raw-target')item.proposal.artifactKey='avg.proposal.environment-brief.wrong'
    if(mode==='unknown-field')Object.assign(item,{approved:true})
    if(mode==='host-id')Object.assign(item,{producerRunId:1})
    if(mode==='fraction')item.buildNumber=1.5
    if(mode==='max-safe')item.buildNumber=Number.MAX_SAFE_INTEGER
    expect(()=>parseAvgVisualPlanningBriefV4(value)).toThrow()
  })
  it('derives the same full governed Plan and review gates with no active text capability or generic carry authority',async()=>{
    const {brief,planning}=await avgVisualPlanningFixtureV4()
    brief.avgVisualPlanning={...planning,proposalReuse:avgVisualPlanningTargetKeysV4(planning.scope).map(source)}
    brief.capabilityRequirements=brief.capabilityRequirements.map(c=>c.mediaClass==='text'?{...c,required:false}:c)
    brief.productionBudget=avgVisualPlanningBudgetV4(brief)
    brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV4(brief)
    const parsed=parseProductProductionBriefV3(brief)
    const plan=buildAvgVisualPlanningPlanV4({brief:{...parsed,avgVisualPlanning:parsed.avgVisualPlanning!},briefHash:h,buildNumber:2,controlEpoch:0})
    expect(parseProductProductionPlanV3(plan,parsed,h)).toEqual(plan)
    expect(plan.tasks.filter(t=>t.executionMode==='model')).toHaveLength(0)
    const reuse=plan.tasks.filter(t=>t.kind==='avg-v4-visual-proposal-reuse')
    expect(reuse).toHaveLength(2)
    expect(reuse.every(t=>t.reuse===null&&t.skillId===null&&t.capabilityRequirementKeys.length===0&&t.budgetReservation.modelCalls===0&&t.budgetReservation.mediaCalls===0)).toBe(true)
    expect(plan.tasks.filter(t=>t.executionMode==='human-import').some(t=>t.outputArtifactKeys.includes('avg.media.visual-bible'))).toBe(true)
    expect(parsed.productionBudget.maximumModelCalls).toBe(0);expect(parsed.productionBudget.maximumMediaCalls).toBe(1)
    expect(()=>buildAvgVisualPlanningPlanV4({brief:{...parsed,avgVisualPlanning:parsed.avgVisualPlanning!},briefHash:h,buildNumber:1,controlEpoch:0})).toThrow(/早于/)
  })
})
