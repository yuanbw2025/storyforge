import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { activePackages, disablePackage, enablePackage, extensionScope, installPackage, putExtensionRecord, uninstallPackage } from '../../src/lib/extensions/store'
import { installExtensionRulePack, previewExtensionRulePack, previewWorldSemantics, publishWorldSemantics } from '../../src/lib/extensions/publication'
import { domainScope } from '../../src/lib/extensions/domain'
import type { ExtensionReviewRequest } from '../../src/lib/extensions/types'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { listAllWorldReleaseResourceDescriptorsV1, readWorldResourceV1 } from '../../src/lib/context-gateway/world-release-provider'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { readProductRuntimeState } from '../../src/lib/ttrpg/runtime-api'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'

beforeEach(async()=>{await db.delete();await db.open()})
afterEach(()=>db.close())
async function bytes(id:string){const data=await readFile(`public/workshop/packages/storyforge.${id}-1.0.0.sfplugin`);return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer}
async function worldPlugin(){const created=await createWorkspace({name:'节庆世界',description:'',genres:[],status:'drafting',targetWordCount:10000},{purpose:'world-engine',kind:'novel',novelProfile:'long'});const scope=await extensionScope(created.project.id!,'world');const pkg=await installPackage(await bytes('world-festivals'));await enablePackage(pkg,scope);const [{profile}]=await activePackages(scope);const request:ExtensionReviewRequest={scope,pluginId:pkg.pluginId,digest:pkg.digest,profileId:profile.id,kind:'world-semantics',semanticId:'culture',recordKeys:['lantern-day'],instruction:''};return{created,profile,pkg,request}}
describe('explicit plugin publication boundaries',()=>{
 it('freezes only confirmed semantics, reads through neutral Gateway and survives code removal',async()=>{
  const {created,profile,pkg,request}=await worldPlugin()
  const before=await createWorldRevision({scope:created.scope,label:'确认前'})
  expect(before.manifestJson).not.toContain('归灯节')
  const preview=await previewWorldSemantics(request), ids=await publishWorldSemantics(request,preview.hash)
  expect(ids).toHaveLength(1);expect(await publishWorldSemantics(request,preview.hash)).toEqual(ids)
  const revision=await createWorldRevision({scope:created.scope,label:'节庆语义封存'}),release=await publishWorldRevision(revision.id!)
  const manifest=JSON.parse(release.manifestJson)
  expect(manifest.records.extensionRecords).toBeUndefined();expect(release.manifestJson).not.toContain('"layout"')
  await disablePackage(profile);await uninstallPackage(pkg)
  const scope={projectId:created.scope.projectId,worldId:created.scope.worldId,worldReleaseId:release.id!,worldReleaseHash:release.contentHash}
  const resources=await listAllWorldReleaseResourceDescriptorsV1(scope), resource=resources.find(item=>item.title==='归灯节')!
  expect(resource).toBeDefined();const read=await readWorldResourceV1({scope,resourceKey:resource.resourceKey,depth:'full',maxTokens:5000})
  expect(read.content).toContain('春季海雾散去后');expect(read.content).toContain(pkg.digest);expect(read.content).not.toContain('cards')
  await db.codexEntries.update(ids[0],{description:'作者后续改写'})
  expect((await readWorldResourceV1({scope,resourceKey:resource.resourceKey,depth:'full',maxTokens:5000})).content).not.toContain('作者后续改写')
 })
 it('rejects stale preview, a foreign scope, and overwrite of independently edited canon',async()=>{
  const {profile,pkg,request}=await worldPlugin(),preview=await previewWorldSemantics(request)
  const record=await db.extensionRecords.where('profileId').equals(profile.id!).first()
  await putExtensionRecord(profile,pkg.manifest,{key:record!.key,schemaId:record!.schemaId,expectedRevision:record!.revision,payload:{...record!.payload as object,summary:'新摘要'}})
  await expect(publishWorldSemantics(request,preview.hash)).rejects.toThrow('改变')
  const updated=await previewWorldSemantics(request),[id]=await publishWorldSemantics(request,updated.hash)
  await db.codexEntries.update(id,{summary:'作者独立编辑'})
  await expect(publishWorldSemantics(request,updated.hash)).rejects.toThrow('已有不同')
  await expect(previewWorldSemantics({...request,scope:{...request.scope,ownerKey:'world:foreign'}})).rejects.toThrow('作用域')
 })
 it('imports versioned rules into owning TTRPG work and leaves an old runtime source unchanged across plugin upgrade/removal',async()=>{
  const world=await seedCurrentProductWorld('插件规则世界')
  const work=await createWorldWork(world.scope.projectId,{title:'插件规则团局',kind:'ttrpg'})
  const scope=await switchActiveWork(world.scope.projectId,work.id!), extension=await extensionScope(scope.projectId,'work',scope.workId)
  const pkg=await installPackage(await bytes('harbor-rules'));await enablePackage(pkg,extension)
  const [{profile}]=await activePackages(extension)
  const request:ExtensionReviewRequest={scope:extension,pluginId:pkg.pluginId,digest:pkg.digest,profileId:profile.id,kind:'rule-pack',ruleId:'harbor',instruction:''}
  const preview=await previewExtensionRulePack(request), ruleId=await installExtensionRulePack(request,preview.hash)
  const sourceCatalog=await loadCurrentProductWorldSourceCatalogV1({scope,worldReleaseId:world.release.id!,productType:'ttrpg'})
  const runtimePackage=await createCurrentTtrpgRuntimePackageFixture({scope,worldRelease:world.release as typeof world.release & {id:number},sourceCatalog,playerController:'human',gmMode:'human',ruleOrigin:'saved-rule-pack',savedRulePackId:ruleId})
  expect(runtimePackage.ttrpg!.rulePack.contentHash).toBe(preview.hash)
  const build=await seedCurrentProductBuild({scope,worldRelease:world.release as typeof world.release & {id:number},runtimePackage,title:'规则版本一'})
  const oldState=await readProductRuntimeState(build.session.id!)
  await disablePackage(profile);await uninstallPackage(pkg)
  const zip=await JSZip.loadAsync(await bytes('harbor-rules')), manifest=JSON.parse(await zip.file('manifest.json')!.async('string')), rules=JSON.parse(await zip.file('assets/rules.json')!.async('string'))
  manifest.version='2.0.0';rules.ruleSystemVersion='2.0.0';rules.title='雾港规则第二版'
  zip.file('manifest.json',JSON.stringify(manifest));zip.file('assets/rules.json',JSON.stringify(rules))
  const next=await installPackage(await zip.generateAsync({type:'arraybuffer'}))
  expect(next.version).toBe('2.0.0')
  const old=await resolveProductRuntimeSource({scope,source:{kind:'build',productBuildId:build.buildId,expectedPreviewHash:build.preview.previewHash}})
  expect(old.runtimePackage.ttrpg!.rulePack.contentHash).toBe(preview.hash)
  expect(old.runtimePackage.ttrpg!.rulePack.content.ruleSystemVersion).toBe('1.0.0');old.mediaResolver.dispose()
  expect(await readProductRuntimeState(build.session.id!)).toEqual(oldState)
  expect((await db.ttrpgRulePacks.get(ruleId))?.contentHash).toBe(preview.hash)
  expect(await domainScope(profile)).toEqual(scope)
 },15000)
})
