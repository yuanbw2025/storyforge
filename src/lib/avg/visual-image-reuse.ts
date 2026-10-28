import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgVisualRawReuseDescriptorV4,avgVisualRawReuseDescriptorV5,avgVisualRawRequirementHashesV4,avgVisualRawRequirementHashesV5,
  parseAvgVisualRawReuseSourceV4,parseAvgVisualRawReuseSourceV5,type AvgVisualRawReuseSourceV4,type AvgVisualRawReuseSourceV5 } from './visual-image-reuse-contract'
import { readAvgHistoricalRawImageV4,type AvgHistoricalVisualBoundaryV4 } from './visual-image-history'
import { readAvgHistoricalRawImageV5 } from './visual-image-history-v5'
import type { AvgHistoricalVisualBoundary } from './visual-history-authority'
import type { AvgVisualArtifactRefV4 } from './visual-planning-reuse-contract'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
/** Preparation is read-only original evidence. The eventual current Plan,
 * local producer, review and author choice are separate mandatory steps. */
export async function prepareAvgVisualRawReuseSourceV4(input:AvgHistoricalVisualBoundaryV4&{artifact:AvgVisualArtifactRefV4}) {
  return avgVisualRawReuseDescriptorV4(await readAvgHistoricalRawImageV4(input))
}

/** V5 source preparation proves the original V5/raw2 compiler, response and
 * Blob. It carries no author choice and grants no new request authority. */
export async function prepareAvgVisualRawReuseSourceV5(input:AvgHistoricalVisualBoundary&{artifact:AvgVisualArtifactRefV4}) {
  return avgVisualRawReuseDescriptorV5(await readAvgHistoricalRawImageV5(input))
}

/** Resolve portable identity after remap and prove the original full V4
 * author/compiler/HTTP/pixel closure again. Original fees, rights, request
 * and model remain unmodified even when a later batch selects another model. */
export async function readAvgVisualRawReuseSourceV4(input:{scope:WorkspaceScope;source:AvgVisualRawReuseSourceV4}) {
  const scope=await resolveScope({scope:input.scope}),source=parseAvgVisualRawReuseSourceV4(input.source)
  if(!scope.workId)throw new Error('[avg-visual-raw-reuse] 原图读取缺少准确作品')
  const owners=await db.productProductions.where('[workId+productionKey]').equals([scope.workId,source.productionKey]).toArray()
  const owned=[]
  for(const owner of owners)if(await assertRecordInScope(scope,'productProductions',owner,{owner:'work'}))owned.push(owner)
  if(owned.length!==1||owned[0].productType!=='avg')throw new Error('[avg-visual-raw-reuse] 原图不属于准确作品的唯一制作记录')
  const production=owned[0],build=await db.productBuilds.where('[productionId+buildNumber]').equals([production.id!,source.raw.buildNumber]).first()
  if(!build?.id||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-raw-reuse] 原图制作版本缺失或跨作品')
  const history=await readAvgHistoricalRawImageV4({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,
    controlEpoch:source.raw.controlEpoch,expectedBriefHash:source.raw.briefHash,expectedPlanHash:source.raw.planHash,
    artifact:{artifactKey:source.raw.artifactKey,version:source.raw.artifactVersion,contentHash:source.raw.contentHash}})
  if(!same(await avgVisualRawReuseDescriptorV4(history),source))throw new Error('[avg-visual-raw-reuse] 原图证明、原需求或世界已变化')
  if(!same(await db.productProductions.get(production.id!),production)||!same(await db.productBuilds.get(build.id),build))throw new Error('[avg-visual-raw-reuse] 原图读取期间制作来源已变化')
  if(!same(await db.productProductionBriefs.get(history.records.brief.id!),history.records.brief))throw new Error('[avg-visual-raw-reuse] 原图授权在读取期间变化')
  for(const row of [...history.records.artifacts,history.raw])if(!same(await db.productBuildArtifacts.get(row.id!),row))throw new Error('[avg-visual-raw-reuse] 原图或编译输入在读取期间变化')
  return {...history,reuseSource:source}
}

/** Resolve portable V5 identity after import/remap, then prove the exact
 * original author/compiler/HTTP/Blob chain again. */
export async function readAvgVisualRawReuseSourceV5(input:{scope:WorkspaceScope;source:AvgVisualRawReuseSourceV5}) {
  const scope=await resolveScope({scope:input.scope}),source=parseAvgVisualRawReuseSourceV5(input.source)
  if(!scope.workId)throw new Error('[avg-visual-raw-reuse] V5 原图读取缺少准确作品')
  const owners=await db.productProductions.where('[workId+productionKey]').equals([scope.workId,source.productionKey]).toArray(),owned=[]
  for(const owner of owners)if(await assertRecordInScope(scope,'productProductions',owner,{owner:'work'}))owned.push(owner)
  if(owned.length!==1||owned[0].productType!=='avg')throw new Error('[avg-visual-raw-reuse] V5 原图不属于准确作品的唯一制作记录')
  const production=owned[0],build=await db.productBuilds.where('[productionId+buildNumber]').equals([production.id!,source.raw.buildNumber]).first()
  if(!build?.id||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-raw-reuse] V5 原图版本缺失或跨作品')
  const history=await readAvgHistoricalRawImageV5({scope,buildId:build.id,expectedBuildRevision:build.stateRevision,
    controlEpoch:source.raw.controlEpoch,expectedBriefHash:source.raw.briefHash,expectedPlanHash:source.raw.planHash,
    artifact:{artifactKey:source.raw.artifactKey,version:source.raw.artifactVersion,contentHash:source.raw.contentHash}})
  if(!same(await avgVisualRawReuseDescriptorV5(history),source))throw new Error('[avg-visual-raw-reuse] V5 原图证明、原需求或世界已变化')
  if(!same(await db.productProductions.get(production.id!),production)||!same(await db.productBuilds.get(build.id),build)
    ||!same(await db.productProductionBriefs.get(history.records.brief.id!),history.records.brief))throw new Error('[avg-visual-raw-reuse] V5 原图读取期间制作授权已变化')
  for(const row of [...history.records.artifacts,history.raw])if(!same(await db.productBuildArtifacts.get(row.id!),row))throw new Error('[avg-visual-raw-reuse] V5 原图或编译输入在读取期间变化')
  return {...history,reuseSource:source}
}

/** Compatibility only, without a synthetic old request against a new model.
 * A caller must supply the actual current compiled requirement and bind the
 * returned evidence to its current local Harness receipt before consumption. */
export async function inspectAvgVisualRawReuseCompatibilityV4(input:Parameters<typeof readAvgVisualRawReuseSourceV4>[0]&{
  productionKey:string;buildNumber:number;sourceWorldContentHash:string;requirement:unknown
}) {
  const source=parseAvgVisualRawReuseSourceV4(input.source),current=await avgVisualRawRequirementHashesV4(input.requirement)
  if(source.productionKey!==input.productionKey||!Number.isSafeInteger(input.buildNumber)||input.buildNumber<=source.raw.buildNumber
    ||source.sourceWorldContentHash!==input.sourceWorldContentHash||source.requirementKey!==current.requirement.requirementKey
    ||source.semanticRequirementHash!==current.semanticRequirementHash)throw new Error('[avg-visual-raw-reuse] 当前需求、世界或版本不兼容；未发送替代请求')
  const history=await readAvgVisualRawReuseSourceV4(input)
  return {...history,currentRequirement:current.requirement,currentRequirementHash:current.requirementHash}
}

/** V5 compatibility is exact over the complete compiled requirement, including
 * every reference-policy decision and consumer target. */
export async function inspectAvgVisualRawReuseCompatibilityV5(input:Parameters<typeof readAvgVisualRawReuseSourceV5>[0]&{
  productionKey:string;buildNumber:number;sourceWorldContentHash:string;requirement:unknown
}){
  const source=parseAvgVisualRawReuseSourceV5(input.source),current=await avgVisualRawRequirementHashesV5(input.requirement)
  if(source.productionKey!==input.productionKey||!Number.isSafeInteger(input.buildNumber)||input.buildNumber<=source.raw.buildNumber
    ||source.sourceWorldContentHash!==input.sourceWorldContentHash||source.requirementKey!==current.requirement.requirementKey
    ||source.semanticRequirementHash!==current.semanticRequirementHash)throw new Error('[avg-visual-raw-reuse] V5 当前需求、世界或版本不兼容；未发送图片请求')
  const history=await readAvgVisualRawReuseSourceV5(input)
  return {...history,currentRequirement:current.requirement,currentRequirementHash:current.requirementHash}
}
