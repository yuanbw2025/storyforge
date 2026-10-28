import type { AvgSystemPlan } from './system-contract'
import type { AvgReadingPlanV1 } from './reading-contract'
import type { AvgConsumerDomainV1 } from './runtime-contract-v2'

/** S2 names describe intent; native admission below describes executable code.
 * Adding a name never grants a renderer, state writer, or release capability. */
export const AVG_MODULE_NAMES_V1 = Object.freeze([
  'narrative','inventory','evidence','hotspots','topics','messages','archive','gallery','progress','assist',
] as const)
export type AvgModuleNameV1 = typeof AVG_MODULE_NAMES_V1[number]
export interface AvgModuleContractV1 {
  name: AvgModuleNameV1
  version: 1
  label: string
  admission: 'native' | 'planned'
  runtimeDependencies: readonly AvgModuleNameV1[]
  stateOwner: 'session' | 'work-profile'
  actions: readonly string[]
  consumerDomains: readonly AvgConsumerDomainV1[]
  restorePolicy: 'events-and-checkpoint' | 'derived-profile-progress'
}
const contract = (value: AvgModuleContractV1): Readonly<AvgModuleContractV1> => Object.freeze({
  ...value, runtimeDependencies:Object.freeze([...value.runtimeDependencies]),
  actions:Object.freeze([...value.actions]), consumerDomains:Object.freeze([...value.consumerDomains]),
})
const session = { version:1 as const, stateOwner:'session' as const, restorePolicy:'events-and-checkpoint' as const }
const profile = { version:1 as const, stateOwner:'work-profile' as const, restorePolicy:'derived-profile-progress' as const }

/** Executable scope only. Planned contracts are extension seams, not accepted
 * runtime payload schemas, empty state tables, or UI menus. */
export const AVG_MODULE_CONTRACTS_V1: Readonly<Record<AvgModuleNameV1,Readonly<AvgModuleContractV1>>> = Object.freeze({
  narrative:contract({...session,name:'narrative',label:'对话与选择',admission:'native',runtimeDependencies:[],actions:['advance','choose'],consumerDomains:['dialogue','stage']}),
  inventory:contract({...session,name:'inventory',label:'物品',admission:'native',runtimeDependencies:['narrative'],actions:['gain','inspect','use','transfer','change-state','remove'],consumerDomains:['inventory']}),
  evidence:contract({...session,name:'evidence',label:'证据与出示',admission:'native',runtimeDependencies:['inventory'],actions:['inspect','present'],consumerDomains:['inventory','evidence']}),
  hotspots:contract({...session,name:'hotspots',label:'热点与地点',admission:'planned',runtimeDependencies:['narrative'],actions:['inspect','move'],consumerDomains:['stage']}),
  topics:contract({...session,name:'topics',label:'话题与关键词',admission:'planned',runtimeDependencies:['narrative'],actions:['ask','think'],consumerDomains:['dialogue']}),
  messages:contract({...session,name:'messages',label:'消息与手机',admission:'planned',runtimeDependencies:['narrative'],actions:['open','reply'],consumerDomains:['dialogue']}),
  archive:contract({...session,name:'archive',label:'档案',admission:'planned',runtimeDependencies:['narrative'],actions:['read','replay'],consumerDomains:['archive']}),
  gallery:contract({...profile,name:'gallery',label:'鉴赏',admission:'planned',runtimeDependencies:['narrative','progress'],actions:['read','replay'],consumerDomains:['gallery']}),
  progress:contract({...profile,name:'progress',label:'跨周目进度',admission:'planned',runtimeDependencies:['narrative'],actions:['derive-unlock'],consumerDomains:[]}),
  assist:contract({...session,name:'assist',label:'提示与辅助',admission:'planned',runtimeDependencies:['narrative'],actions:['reveal','assist'],consumerDomains:['menu']}),
})

export const AVG_NATIVE_CORE_CAPABILITIES_V1 = Object.freeze(['narrative','presentation','avg.rules'] as const)
export interface AvgNativeFeatureInputV1 { systemPlan:AvgSystemPlan; reading?:AvgReadingPlanV1 }
export interface AvgModuleSwitchV1 {
  name:AvgModuleNameV1
  available:boolean
  enabled:boolean
  reason:'configured' | 'not-configured' | 'not-implemented'
}

/** Flags are derived from the validated native payload. No caller-provided
 * boolean, S2 wishlist or restored settings may enable an unimplemented module. */
export function avgNativeModuleSwitchesV1(input:AvgNativeFeatureInputV1):AvgModuleSwitchV1[] {
  const inventory=input.systemPlan.version===2?input.systemPlan.inventory:null
  const configured:Partial<Record<AvgModuleNameV1,boolean>>={narrative:true,inventory:inventory!==null,
    evidence:!!inventory&&(inventory.items.some(item=>item.category==='evidence')||inventory.actions.some(action=>action.verb==='present'))}
  return AVG_MODULE_NAMES_V1.map(name=>{
    const available=AVG_MODULE_CONTRACTS_V1[name].admission==='native',enabled=available&&configured[name]===true
    return {name,available,enabled,reason:!available?'not-implemented':enabled?'configured':'not-configured'}
  })
}

/** Preserve the exact existing Package V2 capability bytes/order. Evidence is
 * the existing inventory protocol, never a second state/action capability. */
export function avgNativeExecutableCapabilitiesV1(input:AvgNativeFeatureInputV1):string[] {
  return [...AVG_NATIVE_CORE_CAPABILITIES_V1,
    ...(input.systemPlan.version===2?['avg.inventory']:[]),
    ...(input.reading?['avg.reading']:[])]
}
