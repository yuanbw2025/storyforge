import Dexie from 'dexie'
import type { WorkspaceScope,ProductProductionBriefV3 } from '../types'
import type { AvgAuthorMediaChoice } from './media-production-contract'
import { readAvgImageConsumptionDefinitionV4 } from './image-consumption'
import { readAvgChosenMediaSourceV2 } from './media-choice-validation'
import type { AvgVisualPlanningBriefV5 } from './visual-planning-brief-v5'
import type { AvgVisualProductionBatchV2 } from './media-production-contract-v2'

type CurrentImageDefinition=Awaited<ReturnType<typeof readAvgImageConsumptionDefinitionV4>>
  |(Pick<AvgVisualPlanningBriefV5,'imageBinding'|'imageProcessing'>&{mediaBatch:AvgVisualProductionBatchV2})

/** Current/frozen consumption only. Each version retains its original Brief,
 * batch, request and reference policy; historical readers remain separate. */
export async function readAvgCurrentImageConsumptionDefinition(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3}):Promise<CurrentImageDefinition>{
  if(input.brief.avgVisualPlanning?.version!==5)return readAvgImageConsumptionDefinitionV4(input)
  const load=()=>import('./image-consumption-v5')
  const {readAvgImageConsumptionDefinitionV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  return (await readAvgImageConsumptionDefinitionV5(input)).definition
}

/** Exact producer/pixels only. Author review/choice command verification and
 * the final stage's scoped adoption are still required by the consuming writer. */
export async function readAvgCurrentChosenMediaSource(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3;choice:AvgAuthorMediaChoice}){
  if(input.brief.avgVisualPlanning?.version!==5)return readAvgChosenMediaSourceV2(input)
  const load=()=>import('./media-choice-validation-v5')
  const {readAvgChosenMediaSourceV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  return readAvgChosenMediaSourceV5(input)
}

/** Full actual compilation for deterministic assembly evidence; never convert
 * a newer scope/compiled batch to an older request or authorize a provider. */
export async function readAvgCurrentCompiledImageDefinition(input:{scope:WorkspaceScope;buildId:number;expectedBuildRevision:number;controlEpoch:number;
  expectedBrief:ProductProductionBriefV3;purpose:'assembly'|'frozen-verification'}){
  if(input.expectedBrief.avgVisualPlanning?.version===5){
    const load=()=>import('./visual-planning-image-definition-v5')
    const {readAvgCompiledImageDefinitionV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    return readAvgCompiledImageDefinitionV5(input)
  }
  const load=()=>import('./visual-planning-image-definition')
  const {readAvgCompiledImageDefinitionV4}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  return readAvgCompiledImageDefinitionV4(input)
}
