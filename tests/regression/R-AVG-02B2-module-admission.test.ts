import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { AVG_MODULE_CONTRACTS_V1, AVG_MODULE_NAMES_V1, avgNativeExecutableCapabilitiesV1, avgNativeModuleSwitchesV1 } from '../../src/lib/avg/module-capabilities'
import { deriveAvgAuthoringSettingsV2, parseAvgAuthoringSettingsV2, parseAvgSettingsForLegacyProduction } from '../../src/lib/avg/settings-v2'
import { DEFAULT_AVG_SETTINGS } from '../../src/lib/avg/authoring-contract'
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { avgReadingFixture } from '../helpers/avg-reading-fixture'
import { avgNativePackage } from '../helpers/avg-native-fixture'
import { parseProductRuntimePackageV2 } from '../../src/lib/product-production/runtime-package'
import { createAvgDraftV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'

describe('AVG module intent, native admission and disabled extension seams',()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>db.close())
  it('keeps module contracts immutable, dependency-closed and acyclic without creating runtime state',()=>{
    const visiting=new Set<string>(),visited=new Set<string>()
    const visit=(name:typeof AVG_MODULE_NAMES_V1[number])=>{
      expect(visiting.has(name)).toBe(false);if(visited.has(name))return
      visiting.add(name)
      const descriptor=AVG_MODULE_CONTRACTS_V1[name]
      expect(descriptor.name).toBe(name);expect(Object.isFrozen(descriptor)).toBe(true)
      expect(new Set(descriptor.runtimeDependencies).size).toBe(descriptor.runtimeDependencies.length)
      descriptor.runtimeDependencies.forEach(visit);visiting.delete(name);visited.add(name)
    }
    AVG_MODULE_NAMES_V1.forEach(visit)
    expect(visited.size).toBe(10)
    expect(Reflect.set(AVG_MODULE_CONTRACTS_V1.gallery,'admission','native')).toBe(false)
  })
  it('derives actual feature flags and preserves the existing capability bytes/order for independent configurations',()=>{
    const linear=createAvgAuthoringPresetV1('linear'),evidence=createAvgAuthoringPresetV1('evidence')
    expect(avgNativeExecutableCapabilitiesV1({systemPlan:linear.systemPlan})).toEqual(['narrative','presentation','avg.rules'])
    expect(avgNativeExecutableCapabilitiesV1({systemPlan:evidence.systemPlan,reading:avgReadingFixture({voices:[]})})).toEqual(['narrative','presentation','avg.rules','avg.inventory','avg.reading'])
    expect(avgNativeModuleSwitchesV1({systemPlan:evidence.systemPlan}).filter(row=>row.enabled).map(row=>row.name)).toEqual(['narrative','inventory','evidence'])
    expect(avgNativeModuleSwitchesV1({systemPlan:linear.systemPlan}).filter(row=>row.enabled).map(row=>row.name)).toEqual(['narrative'])
    for(const input of [linear,evidence])expect(avgNativeModuleSwitchesV1({systemPlan:input.systemPlan}).filter(row=>!row.available).every(row=>!row.enabled&&row.reason==='not-implemented')).toBe(true)
  })
  it('preserves S2 wishlist semantics while keeping professional/native runtime admission distinct',async()=>{
    const settings=await deriveAvgAuthoringSettingsV2(DEFAULT_AVG_SETTINGS)
    settings.modules.push({name:'topics',version:1},{name:'gallery',version:1})
    expect(parseAvgAuthoringSettingsV2(settings)).toEqual(settings)
    expect(()=>parseAvgSettingsForLegacyProduction(settings)).toThrow(/不得降级/)
    const pkg=avgNativePackage()
    for(const name of ['topics','gallery'])expect(()=>parseProductRuntimePackageV2({...pkg,definition:{...pkg.definition,enabledCapabilities:[...pkg.definition.enabledCapabilities,`avg.${name}`]}})).toThrow(/未登记能力/)
    expect(settings.modules.map(module=>module.name)).toContain('gallery')
  })
  it.each(['hotspots','topics','messages','archive','gallery','progress','assist'] as const)('rejects a forged %s capability and undeclared runtime body',name=>{
    const pkg=avgNativePackage()
    expect(()=>parseProductRuntimePackageV2({...pkg,definition:{...pkg.definition,enabledCapabilities:[...pkg.definition.enabledCapabilities,`avg.${name}`]}})).toThrow(/未登记能力/)
    expect(()=>parseProductRuntimePackageV2({...pkg,modules:pkg.modules.map(module=>({...module,[name]:{enabled:true}}))})).toThrow(/未知字段/)
  })
  it('rejects a draft claiming planned modules before any write and retains the prior author bytes',async()=>{
    const s=await createAvgDraftV1('模块准入反例'),draft=await readAvgDraftV1(s.scope),workspace=createAvgAuthoringPresetV1()
    const saved=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,workspace)
    await expect(saveAvgAuthorWorkspaceV1(s.scope,saved.revision,{...workspace,modules:[{name:'gallery',version:1}]} as typeof workspace)).rejects.toThrow(/未知字段/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    expect((await readAvgDraftV1(s.scope)).revision).toBe(saved.revision)
    expect(await db.productProductions.where('workId').equals(s.scope.workId).count()).toBe(0)
  })
})
