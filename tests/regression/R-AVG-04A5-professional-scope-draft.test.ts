import { describe,expect,it } from 'vitest'
import { prepareAvgVisualPlanningSourceDraftV4 } from '../../src/lib/avg/visual-planning-scope-draft'
import { avgVisualPlanningTemplateRequirementsV1 } from '../../src/lib/avg/visual-planning-contract'
import { assertAvgMediaConsumerDeclarationsV1,validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
import { avgProfessionalFamilyScopeFixtureV4 } from '../helpers/avg-professional-family-scope-fixture'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'

describe('AVG professional family source draft prepares only exact prospective consumers',()=>{
  it('prepares environment, pose/expression and one item icon/detail against the actual saved rule shape without mutating the input',async()=>{
    const {workspace,planning}=avgProfessionalFamilyScopeFixtureV4(),original=structuredClone(workspace)
    const result=await prepareAvgVisualPlanningSourceDraftV4({workspace,planning})
    expect(workspace).toEqual(original)
    if(result.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    const item=result.workspace.systemPlan.inventory.items[0]
    expect(item.iconAssetKey).toBe(planning.templates[3].parameters.assetKey)
    expect(item.detailAssetKey).toBe(planning.templates[4].parameters.assetKey)
    item.iconAssetKey=null;item.detailAssetKey=null
    expect(result.workspace).toEqual(original)
    const prepared=await prepareAvgVisualPlanningSourceDraftV4({workspace,planning})
    const batch={schema:'storyforge.avg.visual-production-batch',version:1,batchKey:prepared.scope.batchKey,revision:prepared.scope.revision,
      aspectRatio:prepared.scope.aspectRatio,sourceInputHash:prepared.scope.sourceInputHash,requirements:avgVisualPlanningTemplateRequirementsV1(prepared.scope)}
    await validateAvgVisualProductionBatchSourceV1(batch,prepared.workspace)
    assertAvgMediaConsumerDeclarationsV1(batch,prepared.workspace.systemPlan)
    expect(prepared.workspace.mediaBatch).toBeUndefined();expect(prepared.workspace.presentation.stage.assets).toEqual([])
  })

  it('replaces only the previous exact unused slot proposals and leaves an unrelated author display binding intact',async()=>{
    const first=avgProfessionalFamilyScopeFixtureV4('first'),old=await prepareAvgVisualPlanningSourceDraftV4(first)
    if(old.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    old.workspace.systemPlan.inventory.items[0].variants[0].iconAssetKey='author.unrelated.icon'
    const next=avgProfessionalFamilyScopeFixtureV4('next')
    const prepared=await prepareAvgVisualPlanningSourceDraftV4({workspace:old.workspace,planning:next.planning,previous:old.scope})
    if(prepared.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    expect(prepared.workspace.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.next.letter.icon')
    expect(prepared.workspace.systemPlan.inventory.items[0].variants[0].iconAssetKey).toBe('author.unrelated.icon')
  })

  it('does not clear a selected image to fit a later professional batch',async()=>{
    const first=avgProfessionalFamilyScopeFixtureV4('first'),old=await prepareAvgVisualPlanningSourceDraftV4(first)
    const drawing=(await avgInventoryMediaFixture())[0]
    old.workspace.presentation.stage.assets.push({...drawing.asset,assetKey:first.planning.templates[3].parameters.assetKey})
    const snapshot=structuredClone(old.workspace),next=avgProfessionalFamilyScopeFixtureV4('next')
    await expect(prepareAvgVisualPlanningSourceDraftV4({workspace:old.workspace,planning:next.planning,previous:old.scope})).rejects.toThrow(/绑定其他图片/)
    expect(old.workspace).toEqual(snapshot)
  })

  it('preserves a changed author binding even when a previous unused scope is supplied',async()=>{
    const first=avgProfessionalFamilyScopeFixtureV4(),old=await prepareAvgVisualPlanningSourceDraftV4(first)
    if(old.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    old.workspace.systemPlan.inventory.items[0].detailAssetKey='author.changed.detail'
    await expect(prepareAvgVisualPlanningSourceDraftV4({workspace:old.workspace,planning:avgProfessionalFamilyScopeFixtureV4('next').planning,previous:old.scope})).rejects.toThrow(/绑定其他图片/)
    expect(old.workspace.systemPlan.inventory.items[0].detailAssetKey).toBe('author.changed.detail')
  })

  it('rejects an undeclared item instead of creating an item or rule',async()=>{
    const input=avgProfessionalFamilyScopeFixtureV4(),snapshot=structuredClone(input.workspace)
    input.planning.templates[3].parameters.consumer.subjectKey='undeclared-item'
    await expect(prepareAvgVisualPlanningSourceDraftV4(input)).rejects.toThrow()
    expect(input.workspace).toEqual(snapshot)
  })
})
