import { describe,expect,it } from 'vitest'
import { clearUnusedAvgVisualConsumerSlotsV1,prepareAvgVisualPlanningSourceDraftV4,prepareAvgVisualPlanningSourceDraftV5 } from '../../src/lib/avg/visual-planning-scope-draft'
import { avgVisualPlanningTemplateRequirementsV1 } from '../../src/lib/avg/visual-planning-contract'
import { assertAvgMediaConsumerDeclarationsV1,hashAvgMediaSourceInputV1,validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
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


describe('retiring an exact visual scope clears only its unused item proposals',()=>{
  it('freezes the V5 expression source after exact unused item declarations are retired',async()=>{
    const first=avgProfessionalFamilyScopeFixtureV4('v5-retired'),planning={...first.planning,version:2 as const}
    const original=structuredClone(first.workspace),prepared=await prepareAvgVisualPlanningSourceDraftV5({workspace:first.workspace,planning})
    expect(prepared.scope.sourceInputHash).not.toBe(await hashAvgMediaSourceInputV1(original))
    const before=structuredClone(prepared.workspace),next=await prepareAvgVisualPlanningSourceDraftV5({workspace:prepared.workspace,
      planning:{...planning,templates:planning.templates.filter(t=>t.parameters.mediaKind==='character-expression')},previous:prepared.scope})
    expect(next.workspace).toEqual(original)
    expect(next.scope.sourceInputHash).toBe(await hashAvgMediaSourceInputV1(original))
    expect(prepared.workspace).toEqual(before)
  })
  it('clears base and conditional display proposals without mutating inputs or gameplay',async()=>{
    const input=avgProfessionalFamilyScopeFixtureV4('retire')
    if(input.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    const key=input.workspace.systemPlan.inventory.items[0].variants[0].key
    input.planning.templates[4].parameters.itemVariantKey=key
    const original=structuredClone(input.workspace),prepared=await prepareAvgVisualPlanningSourceDraftV4(input),before=structuredClone(prepared.workspace)
    const next=clearUnusedAvgVisualConsumerSlotsV1(prepared.workspace,prepared.scope)
    expect(next).toEqual(original);expect(prepared.workspace).toEqual(before)
    expect(clearUnusedAvgVisualConsumerSlotsV1(prepared.workspace)).toEqual(before)
  })
  it('preserves selected pixels and a changed author binding while clearing an unused sibling',async()=>{
    const prepared=await prepareAvgVisualPlanningSourceDraftV4(avgProfessionalFamilyScopeFixtureV4('keep'))
    if(prepared.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    const item=prepared.workspace.systemPlan.inventory.items[0],icon=item.iconAssetKey
    prepared.workspace.presentation.stage.assets.push({...((await avgInventoryMediaFixture())[0].asset),assetKey:icon!})
    item.variants[0].detailAssetKey='author.unrelated.detail'
    const before=structuredClone(prepared.workspace),next=clearUnusedAvgVisualConsumerSlotsV1(prepared.workspace,prepared.scope)
    if(next.systemPlan.version!==2)throw new Error('Expected native inventory')
    expect(next.systemPlan.inventory.items[0]).toMatchObject({iconAssetKey:icon,detailAssetKey:null})
    expect(next.systemPlan.inventory.items[0].variants[0].detailAssetKey).toBe('author.unrelated.detail')
    expect(next.presentation.stage.assets).toEqual(before.presentation.stage.assets)
    expect(prepared.workspace).toEqual(before)
  })
})
