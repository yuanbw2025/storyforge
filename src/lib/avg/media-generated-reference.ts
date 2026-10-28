import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgAdoptedGeneratedReferenceChoiceV1, readAvgAdoptedGeneratedReferenceChoiceV4,readAvgAdoptedRevalidatedImageChoiceV4,readAvgAdoptedRevalidatedImageChoiceV5,readAvgAdoptedProcessedVisualChoiceV4, readAvgAdoptedProcessedVisualChoiceV5,readAvgAdoptedGeneratedReferenceChoiceV5 } from './author-artifacts'
import { parseAvgAuthorMediaChoice } from './media-production-contract'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { parseAvgGeneratedReferenceSourceV1, parseAvgGeneratedReferenceSourceV2, parseAvgGeneratedReferenceSourceV3, parseAvgGeneratedReferenceSourceV5, parseAvgGeneratedReferenceSourceV6,parseAvgGeneratedReferenceSourceV7,parseAvgGeneratedReferenceSourceV8,parseAvgGeneratedImageSource,
  type AvgGeneratedReferenceSourceV1, type AvgGeneratedImageSource } from './media-generated-reference-contract'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1, type AvgMediaReferenceV1 } from './media-reference-contract'
import { parseAvgGeneratedReferenceSourceV4 } from './visual-processed-source-contract'
import { parseAvgMediaReferencesV2, type AvgMediaReferenceV2 } from './media-reference-contract-v2'
import { parseAvgGeneratedReferenceSourceV9 } from './visual-region-source-contract'
import { parseAvgImageRegionCompositeReceiptV3 } from './image-region-composite-receipt'

type Evidence = Awaited<ReturnType<typeof readAvgAdoptedGeneratedReferenceChoiceV1>>
const sourceOf = (e: Evidence) => parseAvgGeneratedReferenceSourceV1({ schema:'storyforge.avg.generated-reference-source',version:1,
  productionKey:e.productionKey,requirementKey:e.choice.requirementKey,raw:e.rawProof,
  ...(e.processingProof?{processing:e.processingProof}:{}),
  choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash} })
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

function assertReferenceSize(e: Evidence) {
  if (e.choice.asset.byteSize > AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes) throw new Error('[avg-media] 此原图超过 8 MiB 参考输入上限；请先创建有来源记录的加工候选')
}

/** No import alias or new media row is created. The original adopted choice
 * remains the sole authority; each later outbound request obtains new consent. */
export async function prepareAvgGeneratedReferenceImageV1(input: { scope: WorkspaceScope; choiceId: number }) {
  const scope = await resolveScope({scope:input.scope}), row = await db.productBuildArtifacts.get(input.choiceId)
  if (!row || row.status !== 'accepted' || !row.artifactKey.startsWith('avg.media.choice.')
    || !await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})) throw new Error('[avg-media] 请先明确采用当前作品的准确生成图')
  const evidence = await readAvgAdoptedGeneratedReferenceChoiceV1({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
    artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
  assertReferenceSize(evidence)
  return {asset:evidence.choice.asset,source:sourceOf(evidence)}
}

export async function readAvgAdoptedGeneratedImageV1(input: { scope: WorkspaceScope; source: AvgGeneratedReferenceSourceV1 }) {
  const scope = await resolveScope({scope:input.scope}), source = parseAvgGeneratedReferenceSourceV1(input.source)
  const productions = await db.productProductions.where('workId').equals(scope.workId)
    .filter(p=>p.productType==='avg'&&p.productionKey===source.productionKey).limit(2).toArray()
  if (productions.length!==1 || !productions[0].id || !await assertRecordInScope(scope,'productProductions',productions[0],{owner:'work'})) throw new Error('[avg-media] 生成参考制作来源不存在、重复或跨作品')
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([productions[0].id,source.raw.buildNumber]).first()
  if (!build?.id || build.briefHash!==source.raw.briefHash || build.planHash!==source.raw.planHash
    || !await assertRecordInScope(scope,'productBuilds',build,{owner:'work'})) throw new Error('[avg-media] 生成参考的冻结版本已变化')
  const evidence = await readAvgAdoptedGeneratedReferenceChoiceV1({scope,buildId:build.id,controlEpoch:source.raw.controlEpoch,...source.choice})
  if (!same(sourceOf(evidence),source)) throw new Error('[avg-media] 生成参考的作者或 producer 证明已变化')
  const blob = evidence.image.blobObjectId===null ? null : await db.mediaBlobObjects.get(evidence.image.blobObjectId)
  if (!blob || !await assertRecordInScope(scope,'mediaBlobObjects',blob,{owner:'work'})
    || blob.contentHash!==evidence.choice.asset.contentHash || blob.mimeType!==evidence.choice.asset.mimeType
    || blob.byteSize!==evidence.choice.asset.byteSize) throw new Error('[avg-media] 生成参考缺少当前作品的准确原图字节')
  const readData=()=>readVerifiedMediaBlobObjectData(blob)
  const data=Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(readData),20_000):await readData()
  return {asset:evidence.choice.asset,source,family:evidence.requirement.family,referenceOnly:evidence.choice.referenceOnly,
    sourceWorldContentHash:evidence.sourceWorldContentHash,blobObjectId:evidence.image.blobObjectId!,data}
}

/** Provider reference limits do not restrict a local stage preview. */
export async function readAvgGeneratedReferenceImageV1(input: { scope: WorkspaceScope; source: AvgGeneratedReferenceSourceV1 }) {
  const image=await readAvgAdoptedGeneratedImageV1(input)
  if(image.asset.byteSize>AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes)throw new Error('[avg-media] 此原图超过 8 MiB 参考输入上限；请先创建有来源记录的加工候选')
  return image
}

export async function prepareAvgAdoptedGeneratedImageV1(input:{scope:WorkspaceScope;choiceId:number}){
  const scope=await resolveScope({scope:input.scope}),row=await db.productBuildArtifacts.get(input.choiceId)
  if(!row||row.status!=='accepted'||!row.artifactKey.startsWith('avg.media.choice.')||!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'}))throw new Error('[avg-media] 需要当前作品准确的已采用生成图')
  const evidence=await readAvgAdoptedGeneratedReferenceChoiceV1({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
    artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
  return {asset:evidence.choice.asset,source:sourceOf(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
}

const sourceOfV4=(e:Awaited<ReturnType<typeof readAvgAdoptedGeneratedReferenceChoiceV4>>)=>parseAvgGeneratedReferenceSourceV2({
  schema:'storyforge.avg.generated-reference-source',version:2,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})

const sourceOfV5=(e:Awaited<ReturnType<typeof readAvgAdoptedGeneratedReferenceChoiceV5>>)=>parseAvgGeneratedReferenceSourceV5({
  schema:'storyforge.avg.generated-reference-source',version:5,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})

const sourceOfProcessedV5=(e:Awaited<ReturnType<typeof readAvgAdoptedProcessedVisualChoiceV5>>)=>{
  if(JSON.parse(e.image.payloadJson).version===3)throw new Error('[avg-composite] 旧来源6不能解释局部合成图')
  return parseAvgGeneratedReferenceSourceV6({
  schema:'storyforge.avg.generated-reference-source',version:6,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,processing:e.processingProof,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})}

const sourceOfRevalidatedV5=(e:Awaited<ReturnType<typeof readAvgAdoptedRevalidatedImageChoiceV5>>)=>parseAvgGeneratedReferenceSourceV7({
  schema:'storyforge.avg.generated-reference-source',version:7,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,original:e.rawReuseSource,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})
const sourceOfProcessedRevalidatedV5=(e:Awaited<ReturnType<typeof readAvgAdoptedProcessedVisualChoiceV5>>)=>{
  if(JSON.parse(e.image.payloadJson).version===3)throw new Error('[avg-composite] 旧来源8不能解释局部合成图')
  return parseAvgGeneratedReferenceSourceV8({
  schema:'storyforge.avg.generated-reference-source',version:8,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,original:e.rawReuseSource,processing:e.processingProof,compilation:e.compilation,
  choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})}
const sourceOfComposedV5=(e:Awaited<ReturnType<typeof readAvgAdoptedProcessedVisualChoiceV5>>)=>{
  const payload=JSON.parse(e.image.payloadJson)
  if(payload.version!==3)throw new Error('[avg-composite] 来源9要求准确局部合成图')
  const receipt=parseAvgImageRegionCompositeReceiptV3(payload.receipt)
  return parseAvgGeneratedReferenceSourceV9({schema:'storyforge.avg.generated-reference-source',version:9,
    productionKey:e.productionKey,requirementKey:e.choice.requirementKey,raw:e.rawProof,original:e.rawReuseSource??null,
    processing:e.processingProof,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review,
    composition:{recipeHash:receipt.recipeHash,processingReceiptHash:receipt.receiptHash,baseReferenceHash:receipt.inputProof.baseReferenceHash,
      baseGeneratedSourceHash:receipt.inputProof.baseGeneratedSourceHash,inputProofHash:receipt.inputProof.inputProofHash}})
}

const sourceOfRevalidatedV4=(e:Awaited<ReturnType<typeof readAvgAdoptedRevalidatedImageChoiceV4>>)=>parseAvgGeneratedReferenceSourceV3({
  schema:'storyforge.avg.generated-reference-source',version:3,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,original:e.original,compilation:e.compilation,choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})

const sourceOfProcessedV4=(e:Awaited<ReturnType<typeof readAvgAdoptedProcessedVisualChoiceV4>>)=>parseAvgGeneratedReferenceSourceV4({
  schema:'storyforge.avg.generated-reference-source',version:4,productionKey:e.productionKey,requirementKey:e.choice.requirementKey,
  raw:e.rawProof,processing:e.processingProof,...(e.original?{original:e.original}:{}),compilation:e.compilation,
  choice:{...e.artifact,authorReceiptHash:e.authorReceiptHash},review:e.review})

/** Local stage sources dispatch by their explicit version. Old V1 readers
 * and outbound reference parsing retain their existing closed contracts. */
export async function prepareAvgAdoptedGeneratedImageV2(input:{scope:WorkspaceScope;choiceId:number}){
  const scope=await resolveScope({scope:input.scope}),row=await db.productBuildArtifacts.get(input.choiceId)
  if(!row||row.status!=='accepted'||!row.artifactKey.startsWith('avg.media.choice.')||!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'}))throw new Error('[avg-media] 需要当前作品准确的已采用生成图')
  const build=await db.productBuilds.get(row.buildId),brief=build?await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first():null
  if(!brief||!JSON.parse(brief.briefJson).avgVisualPlanning)return prepareAvgAdoptedGeneratedImageV1(input)
  if(JSON.parse(brief.briefJson).avgVisualPlanning.version===5){
    if(JSON.parse(brief.briefJson).avgVisualPlanning.imageProcessing?.entries.some((e:{requirementKey:string})=>row.artifactKey===`avg.media.choice.${e.requirementKey}`)){
      const evidence=await readAvgAdoptedProcessedVisualChoiceV5({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
        artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
      return {asset:evidence.choice.asset,source:JSON.parse(evidence.image.payloadJson).version===3?sourceOfComposedV5(evidence):evidence.rawReuseSource?sourceOfProcessedRevalidatedV5(evidence):sourceOfProcessedV5(evidence),
        referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
    }
    if(JSON.parse(brief.briefJson).avgVisualPlanning.rawReuse?.some((e:{requirementKey:string})=>row.artifactKey===`avg.media.choice.${e.requirementKey}`)){
      const evidence=await readAvgAdoptedRevalidatedImageChoiceV5({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
        artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
      return {asset:evidence.choice.asset,source:sourceOfRevalidatedV5(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
    }
    const evidence=await readAvgAdoptedGeneratedReferenceChoiceV5({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
      artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
    return {asset:evidence.choice.asset,source:sourceOfV5(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
  }
  if(JSON.parse(brief.briefJson).avgVisualPlanning.imageProcessing?.entries.some((e:{requirementKey:string})=>row.artifactKey===`avg.media.choice.${e.requirementKey}`)){
    const evidence=await readAvgAdoptedProcessedVisualChoiceV4({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
      artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
    return {asset:evidence.choice.asset,source:sourceOfProcessedV4(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
  }
  if(JSON.parse(brief.briefJson).avgVisualPlanning.rawReuse?.some((r:{requirementKey:string})=>row.artifactKey===`avg.media.choice.${r.requirementKey}`)){
    const evidence=await readAvgAdoptedRevalidatedImageChoiceV4({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
      artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
    return {asset:evidence.choice.asset,source:sourceOfRevalidatedV4(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
  }
  const evidence=await readAvgAdoptedGeneratedReferenceChoiceV4({scope,buildId:row.buildId,controlEpoch:row.controlEpoch,
    artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
  return {asset:evidence.choice.asset,source:sourceOfV4(evidence),referenceOnly:evidence.choice.referenceOnly,sourceWorldContentHash:evidence.sourceWorldContentHash}
}

export async function readAvgAdoptedGeneratedImageV2(input:{scope:WorkspaceScope;source:AvgGeneratedImageSource}){
  const source=parseAvgGeneratedImageSource(input.source)
  if(source.version===1)return readAvgAdoptedGeneratedImageV1({...input,source})
  const scope=await resolveScope({scope:input.scope})
  const productions=await db.productProductions.where('workId').equals(scope.workId)
    .filter(p=>p.productType==='avg'&&p.productionKey===source.productionKey).limit(2).toArray()
  if(productions.length!==1||!productions[0].id||!await assertRecordInScope(scope,'productProductions',productions[0],{owner:'work'}))throw new Error('[avg-visual-history] 原图制作来源不存在、重复或跨作品')
  const build=await db.productBuilds.where('[productionId+buildNumber]').equals([productions[0].id,source.raw.buildNumber]).first()
  if(!build?.id||build.briefHash!==source.raw.briefHash||build.planHash!==source.raw.planHash||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-history] 原图版本已变化')
  const boundary={scope,buildId:build.id,controlEpoch:source.raw.controlEpoch,...source.choice}
  const {evidence,proved}=await(async()=>{
    if(source.version===9){const e=await readAvgAdoptedProcessedVisualChoiceV5(boundary);return {evidence:e,proved:sourceOfComposedV5(e)}}
    if(source.version===6){const e=await readAvgAdoptedProcessedVisualChoiceV5(boundary);return {evidence:e,proved:sourceOfProcessedV5(e)}}
    if(source.version===8){const e=await readAvgAdoptedProcessedVisualChoiceV5(boundary);return {evidence:e,proved:sourceOfProcessedRevalidatedV5(e)}}
    if(source.version===7){const e=await readAvgAdoptedRevalidatedImageChoiceV5(boundary);return {evidence:e,proved:sourceOfRevalidatedV5(e)}}
    if(source.version===5){const e=await readAvgAdoptedGeneratedReferenceChoiceV5(boundary);return {evidence:e,proved:sourceOfV5(e)}}
    if(source.version===4){const e=await readAvgAdoptedProcessedVisualChoiceV4(boundary);return {evidence:e,proved:sourceOfProcessedV4(e)}}
    if(source.version===3){const e=await readAvgAdoptedRevalidatedImageChoiceV4(boundary);return {evidence:e,proved:sourceOfRevalidatedV4(e)}}
    const e=await readAvgAdoptedGeneratedReferenceChoiceV4(boundary);return {evidence:e,proved:sourceOfV4(e)}
  })()
  if(!same(proved,source))throw new Error('[avg-visual-history] 原图、复验、编译、评审或作者证明已变化')
  const blob=evidence.image.blobObjectId===null?null:await db.mediaBlobObjects.get(evidence.image.blobObjectId)
  if(!blob||!await assertRecordInScope(scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==evidence.choice.asset.contentHash
    ||blob.mimeType!==evidence.choice.asset.mimeType||blob.byteSize!==evidence.choice.asset.byteSize)throw new Error('[avg-visual-history] 原图缺少准确同作品字节')
  const read=()=>readVerifiedMediaBlobObjectData(blob)
  const data=Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(read),20_000):await read()
  return {asset:evidence.choice.asset,source,family:evidence.requirement.family,referenceOnly:evidence.choice.referenceOnly,
    sourceWorldContentHash:evidence.sourceWorldContentHash,blobObjectId:evidence.image.blobObjectId!,data}
}

/** Prospective reference selection only. A later V2 request must separately
 * declare purpose, permitted/excluded features and outbound/derivative consent. */
export async function prepareAvgGeneratedReferenceImageV2(input:{scope:WorkspaceScope;choiceId:number}){
  const selected=await prepareAvgAdoptedGeneratedImageV2(input)
  if(selected.asset.byteSize>AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes)throw new Error('[avg-reference] 已采用图超过8 MiB参考上限；不得隐式缩放')
  return selected
}

export async function readAvgGeneratedReferenceImageV2(input:{scope:WorkspaceScope;source:AvgGeneratedImageSource}){
  const image=await readAvgAdoptedGeneratedImageV2(input)
  if(image.asset.byteSize>AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes)throw new Error('[avg-reference] 已采用图超过8 MiB参考上限；不得隐式缩放')
  return image
}

/** No same-key import fallback. Source parsing, original/current producer,
 * compilation, review/choice and exact Work bytes all precede delivery. */
export async function readAvgGeneratedReferenceForPurposeV2(scope:WorkspaceScope,reference:AvgMediaReferenceV2,targetFamily?:AvgVisualProductionRequirementV1['family']){
  const ref=parseAvgMediaReferencesV2([reference])[0]!
  if(!ref.generatedSource)throw new Error('[avg-reference] 缺少准确已采用生成来源')
  const image=await readAvgGeneratedReferenceImageV2({scope,source:ref.generatedSource}),asset=image.asset
  if(asset.assetKey!==ref.assetKey||asset.version!==ref.assetVersion||asset.contentHash!==ref.contentHash
    ||asset.mimeType!==ref.mimeType||asset.byteSize!==ref.byteSize||asset.license!==ref.license)throw new Error('[avg-reference] 已采用参考版本、字节或授权元数据不一致')
  if(ref.purpose==='identity'&&targetFamily){
    if(image.family.subjectKey!==targetFamily.subjectKey)throw new Error('[avg-reference] 身份参考不能替换另一个主体')
    if(image.family.familyKey===targetFamily.familyKey&&image.family.revision!==targetFamily.revision)throw new Error('[avg-reference] 身份家族基准修订已变化')
  }
  return image
}

export async function readAvgGeneratedReferenceBytesV2(scope:WorkspaceScope,reference:AvgMediaReferenceV2,targetFamily?:AvgVisualProductionRequirementV1['family']){
  return (await readAvgGeneratedReferenceForPurposeV2(scope,reference,targetFamily)).data
}

/** Actual source is verified before delivery. Matching an imported asset key
 * never substitutes for a missing generated-image proof. */
export async function readAvgGeneratedReferenceBytesV1(scope: WorkspaceScope, reference: AvgMediaReferenceV1, targetFamily?: AvgVisualProductionRequirementV1['family']) {
  if (!reference.generatedSource) throw new Error('[avg-media] 缺少准确生成参考来源')
  const image = await readAvgGeneratedReferenceImageV1({scope,source:reference.generatedSource}), asset = image.asset
  if (asset.assetKey!==reference.assetKey || asset.version!==reference.assetVersion || asset.contentHash!==reference.contentHash
    || asset.mimeType!==reference.mimeType || asset.byteSize!==reference.byteSize || asset.license!==reference.license) throw new Error('[avg-media] 生成参考的字节、版本或授权元数据不一致')
  if(reference.purpose==='identity'&&targetFamily){
    if(image.family.subjectKey!==targetFamily.subjectKey)throw new Error('[avg-media] 身份参考不能替换另一个主体')
    if(image.family.familyKey===targetFamily.familyKey&&image.family.revision!==targetFamily.revision)throw new Error('[avg-media] 同一家族的身份基准版本已变化，请明确采用新的基准')
  }
  return image.data
}

export async function validateAvgGeneratedReferencesV1(scope: WorkspaceScope, references: AvgMediaReferenceV1[], targetFamily?: AvgVisualProductionRequirementV1['family']) {
  const verified = new Set<string>()
  for (const reference of references) {
    if (!reference.generatedSource) continue
    const key = canonicalProductProductionJsonV2(reference)
    if (verified.has(key)) continue
    await readAvgGeneratedReferenceBytesV1(scope, reference, targetFamily)
    verified.add(key)
  }
}

/** Picker inventory only. Selection separately verifies the full proof and
 * actual decoder; local IDs stay in this UI query, never in a frozen request. */
export async function listAvgGeneratedReferenceImagesV1(scopeInput: WorkspaceScope, beforeId?: number) {
  const scope = await resolveScope({scope:scopeInput})
  if (beforeId!==undefined && (!Number.isSafeInteger(beforeId)||beforeId<1)) throw new Error('[avg-media] 生成参考分页位置无效')
  const rows = await db.productBuildArtifacts.where('workId').equals(scope.workId).reverse()
    .filter(row=>row.status==='accepted'&&row.artifactKey.startsWith('avg.media.choice.')&&(beforeId===undefined||row.id!<beforeId)).limit(33).toArray()
  const items=[]
  for (const row of rows.slice(0,32)) {
    if (!row.id || !await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})) throw new Error('[avg-media] 生成参考目录跨作品')
    const choice = parseAvgAuthorMediaChoice(row.payloadJson)
    items.push({choiceId:row.id,name:choice.asset.name,contentHash:choice.asset.contentHash,tooLarge:choice.asset.byteSize>AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes})
  }
  return {items,nextCursor:rows.length>32?rows[31].id!:null}
}
