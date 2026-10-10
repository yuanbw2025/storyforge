import Dexie from 'dexie'
import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { adopt } from '../registry/adopt'
import { readOwnedRows, scopeTransactionTables } from '../workspace/scope'
import type { CodexCategory, CodexEntry, RulePackV1 } from '../types'
import { checkActiveProfile, listExtensionRecords } from './store'
import { domainScope } from './domain'
import { parseManifest, verifyInstalledPackage } from './package'
import { isObject } from './schema'
import type { ExtensionReviewRequest } from './types'

async function declaration(request: ExtensionReviewRequest) {
  const profile = await db.extensionProfiles.get(request.profileId ?? -1)
  if (!profile || profile.pluginId !== request.pluginId || profile.digest !== request.digest || profile.ownerKey !== request.scope.ownerKey || profile.projectId !== request.scope.projectId) throw new Error('贡献来源或作用域已改变')
  await checkActiveProfile(profile)
  const contract = await db.extensionContracts.where('profileId').equals(profile.id!).filter(row=>row.digest===profile.digest).first()
  if (!contract) throw new Error('贡献声明不存在')
  return { profile, manifest:parseManifest(contract.manifest), scope:await domainScope(profile) }
}
export async function previewWorldSemantics(request: ExtensionReviewRequest) {
  const { profile,manifest,scope }=await declaration(request)
  const spec=manifest.worldSemantics?.find(item=>item.id===request.semanticId)
  if (request.kind!=='world-semantics' || !profile.worldId || !spec || !manifest.permissions.includes('world.publish') || !request.recordKeys?.length || request.recordKeys.length>100 || new Set(request.recordKeys).size!==request.recordKeys.length) throw new Error('世界语义贡献无效')
  const all=await listExtensionRecords(profile,spec.schemaId)
  const rows=request.recordKeys.map(key=>{const row=all.find(item=>item.key===key);if(!row||!isObject(row.payload))throw new Error('语义记录不存在或不符合 schema');return row})
  const entries=await Promise.all(rows.map(async row=>{
    const payload=row.payload as Record<string,unknown>
    const name=String(payload[spec.titleField]??'').trim(), summary=String(payload[spec.summaryField]??''), description=String(payload[spec.descriptionField]??'')
    if (!name || name.length>200 || summary.length>2000 || description.length>20000) throw new Error('世界语义标题、摘要或描述超过限制')
    const semanticFields=Object.fromEntries(spec.fields.map(key=>[key,String(payload[key]??'')]))
    const source={pluginId:profile.pluginId,version:profile.version,digest:profile.digest,semanticId:spec.id,schemaId:row.schemaId,schemaVersion:row.schemaVersion,recordKey:row.key}
    const fields={...semanticFields,extensionSource:canonicalStringify(source)}
    return {key:row.key,revision:row.revision,name,summary,description,fields,sourceContentHash:await Dexie.waitFor(hashCanonicalValue({source,name,summary,description,semanticFields}))}
  }))
  const fieldSchema=JSON.stringify([...spec.fields.map(key=>({key,label:manifest.schemas[spec.schemaId].schema.properties![key].description||key,type:'longtext'})),{key:'extensionSource',label:'扩展来源与版本',type:'longtext'}])
  const categoryName=`${spec.title} · ${manifest.id} ${manifest.version}`
  const body={profile,spec,scope,entries,fieldSchema,categoryName}
  return {...body,hash:await Dexie.waitFor(hashCanonicalValue(body))}
}
/** A confirmed one-way projection: canon remains editable without its plugin. No runtime metadata is exported. */
export async function publishWorldSemantics(request: ExtensionReviewRequest, expectedPreviewHash: string): Promise<number[]> {
  const preview=await previewWorldSemantics(request)
  if(preview.hash!==expectedPreviewHash)throw new Error('预览后内容已改变，请重新检查')
  return db.transaction('rw',scopeTransactionTables(db.extensionProfiles,db.extensionContracts,db.extensionRecords,db.codexCategories,db.codexEntries),async()=>{
    const current=await previewWorldSemantics(request)
    if(current.hash!==expectedPreviewHash)throw new Error('确认期间语义记录已改变')
    const {scope,spec,fieldSchema,categoryName,entries}=current
    let category=(await readOwnedRows<CodexCategory>(scope,'codexCategories',{owner:'world'})).find(row=>row.name===categoryName&&row.domain===spec.domain&&row.parentId==null)
    if(category && category.fieldSchema!==fieldSchema)throw new Error('目标分类已被作者修改，请保留原分类并使用新插件版本')
    if(!category){
      const result=await adopt({projectId:scope.projectId,scope,target:'codexCategories',mode:'add',data:{name:categoryName,domain:spec.domain,parentId:null,fieldSchema,order:1000}})
      if(result.written.length!==1)throw new Error('未能建立世界语义分类')
      category=await db.codexCategories.get(result.written[0].id)
    }
    if(!category?.id)throw new Error('语义分类不存在')
    const existing=(await readOwnedRows<CodexEntry>(scope,'codexEntries',{owner:'world'})).filter(row=>row.categoryId===category!.id)
    const ids:number[]=[]
    for(const entry of entries){
      const old=existing.find(row=>row.name===entry.name)
      if(old){
        if(old.sourceContentHash!==entry.sourceContentHash || old.summary!==entry.summary || old.description!==entry.description || old.fields!==canonicalStringify(entry.fields))throw new Error(`“${entry.name}”已有不同正式内容；请在世界词条中人工合并或为新版本改名`)
        ids.push(old.id!);continue
      }
      const result=await adopt({projectId:scope.projectId,scope,target:'codexEntries',mode:'add',data:{categoryId:category.id,name:entry.name,summary:entry.summary,description:entry.description,fields:canonicalStringify(entry.fields),refs:'{}',tags:'[]',origin:'import',sourceEvidenceQuotes:'[]',sourceContentHash:entry.sourceContentHash,producerRunId:null,producerCandidateHash:null,order:existing.length+ids.length,worldGroupId:null}})
      if(result.written.length!==1)throw new Error('语义词条未完整写入')
      ids.push(result.written[0].id)
    }
    return ids
  })
}
export async function previewExtensionRulePack(request: ExtensionReviewRequest): Promise<{rulePack:RulePackV1;hash:string;scope:Awaited<ReturnType<typeof domainScope>>}> {
  const {profile,manifest,scope}=await declaration(request)
  const spec=manifest.rulePacks?.find(item=>item.id===request.ruleId), work=await db.works.get(scope.workId)
  if(request.kind!=='rule-pack'||!spec||!profile.workId||!manifest.permissions.includes('product.rules')||work?.kind!=='ttrpg')throw new Error('此规则贡献只适用于当前跑团作品')
  const pkg=await db.extensionPackages.where('[pluginId+version]').equals([profile.pluginId,profile.version]).first()
  if(!pkg||pkg.digest!==profile.digest)throw new Error('锁定的规则插件包缺失')
  const verified=await verifyInstalledPackage(pkg), text=await verified.zip.file(spec.asset)!.async('string')
  if(text.length>1000000)throw new Error('规则包超过 1 MB')
  const {parseRulePackV1,runRulePackFixturesV1}=await import('../ttrpg/rule-pack')
  const rulePack=parseRulePackV1(JSON.parse(text));runRulePackFixturesV1(rulePack)
  if(rulePack.ruleSystemId!==`${manifest.id}.${spec.id}`||rulePack.ruleSystemVersion!==manifest.version)throw new Error('规则身份必须为插件命名空间.规则 id，版本必须与插件一致')
  return {rulePack,hash:await hashProductProductionValueV2(rulePack),scope}
}
export async function installExtensionRulePack(request: ExtensionReviewRequest, expectedHash:string): Promise<number> {
  const preview=await previewExtensionRulePack(request)
  if(preview.hash!==expectedHash)throw new Error('规则预览已经变化')
  const {saveTtrpgRulePackV1}=await import('../ttrpg/rule-pack-library')
  // The RulePack service hashes before its own write transaction; here an exact
  // frozen package supplies the content. Selecting it for production remains explicit.
  const existing=await db.ttrpgRulePacks.where('[workId+ruleSystemId+ruleSystemVersion]').equals([preview.scope.workId,preview.rulePack.ruleSystemId,preview.rulePack.ruleSystemVersion]).first()
  if(existing&&existing.contentHash!==preview.hash)throw new Error('相同规则版本已有不同内容，拒绝替换')
  const saved=await saveTtrpgRulePackV1({scope:preview.scope,rulePack:preview.rulePack,status:'validated',immutable:true})
  return saved.id!
}
