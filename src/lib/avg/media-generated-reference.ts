import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgAdoptedGeneratedReferenceChoiceV1 } from './author-artifacts'
import { parseAvgAuthorMediaChoice } from './media-production-contract'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { parseAvgGeneratedReferenceSourceV1, type AvgGeneratedReferenceSourceV1 } from './media-generated-reference-contract'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1, type AvgMediaReferenceV1 } from './media-reference-contract'

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
