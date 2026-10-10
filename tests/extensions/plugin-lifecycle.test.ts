import { cascadeDeleteChapterRecords } from '../../src/lib/chapters/lifecycle'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { compileExtensionFlow, createExtensionFlow } from '../../src/lib/extensions/flows'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { parseManifest, readPackage } from '../../src/lib/extensions/package'
import { checkSchema } from '../../src/lib/extensions/schema'
import { activePackages, disablePackage, enablePackage, extensionScope, installPackage, listExtensionRecords, orderPackages, putExtensionRecord, restoreGeneration, uninstallPackage, upgradePackage } from '../../src/lib/extensions/store'

async function bytes(id = 'writing-notes') { const data = await readFile(`public/workshop/packages/storyforge.${id}-1.0.0.sfplugin`); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }
async function setup(owner: 'work' | 'world' = 'work') { const created = await createWorkspace({ name: '插件验证', description: '', genres: [], status: 'drafting', targetWordCount: 30000 }, { purpose: owner === 'world' ? 'world-engine' : 'independent-work', kind: 'novel', novelProfile: 'long' }); return { created, scope: await extensionScope(created.project.id!, owner) } }
async function notes() { const { scope, created } = await setup(); const pkg = await installPackage(await bytes()); await enablePackage(pkg, scope); const [{ profile }] = await activePackages(scope); return { scope, created, pkg, profile } }
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('plugin packages and contracts', () => {
  it('validates every distributed reference package without executing code', async () => { for (const id of ['writing-notes','calendar','world-timeline','story-board','prompt-cards','writer-kit','plot-flow','research-desk','idea-cards','world-festivals','harbor-rules','tool-desk']) { const result = await readPackage(await bytes(id)); expect(result.manifest.id).toBe(`storyforge.${id}`) } })
  it('rejects unknown declarations, remote schema refs and incompatible SDK', async () => { const { manifest } = await readPackage(await bytes()); expect(() => parseManifest({ ...manifest, api: 9 })).toThrow('不兼容'); expect(() => parseManifest({ ...manifest, hidden: true })).toThrow('未知'); expect(() => checkSchema({ type: 'string', $ref: 'https://x.example/schema' })).toThrow('关键字'); expect(() => parseManifest({ ...manifest, networkOrigins: ['https://x.example/path'] })).toThrow() })
  it('rejects path traversal archives before installation', async () => { const zip = new JSZip(); zip.file('../outside.js', 'bad'); zip.file('manifest.json', '{}'); await expect(readPackage(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow('路径') })
  it('same version cannot silently replace installed bytes', async () => { const original = await bytes(); await installPackage(original); const zip = await JSZip.loadAsync(original); zip.file('assets/extra.txt', 'different'); await expect(installPackage(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow('不同内容'); expect(await db.extensionPackages.count()).toBe(1) })
  it('dependencies activate first, missing/cyclic dependencies and competing replacements fail', async () => { const calendar = await installPackage(await bytes('calendar')), timeline = await installPackage(await bytes('world-timeline')); expect(orderPackages([timeline, calendar]).map(pkg => pkg.pluginId)).toEqual(['storyforge.calendar','storyforge.world-timeline']); expect(() => orderPackages([timeline])).toThrow('依赖'); expect(() => orderPackages([timeline, { ...calendar, manifest: { ...calendar.manifest, dependencies: { 'storyforge.world-timeline': '1.0.0' } } }])).toThrow('循环'); expect(() => orderPackages([calendar,timeline,{ ...timeline, pluginId: 'another.timeline', manifest: { ...timeline.manifest, id: 'another.timeline' } }])).toThrow('替换') })
})
describe('plugin scoped data lifecycle', () => {
  it('keeps data across disable, uninstall, reinstall; rejects writes by a disposed profile', async () => { const { profile, pkg, scope } = await notes(); await putExtensionRecord(profile, pkg.manifest, { key: 'main', schemaId: 'note', payload: { text: '保留的手稿' }, expectedRevision: null }); await disablePackage(profile); await expect(listExtensionRecords(profile)).rejects.toThrow('变化'); await uninstallPackage(pkg); expect(await db.extensionRecords.count()).toBe(1); const installed = await installPackage(await bytes()); await enablePackage(installed, scope); const [{ profile: restored }] = await activePackages(scope); expect((await listExtensionRecords(restored))[0].payload).toEqual({ text: '保留的手稿' }) })
  it('uses atomic revision checks and rejects undeclared schema/invalid payload', async () => { const { profile, pkg } = await notes(); const input = { key: 'main', schemaId: 'note', payload: { text: 'a' }, expectedRevision: null }; const results = await Promise.allSettled([putExtensionRecord(profile,pkg.manifest,input),putExtensionRecord(profile,pkg.manifest,input)]); expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); await expect(putExtensionRecord(profile,pkg.manifest,{ ...input,key:'bad',payload:{ other: true } })).rejects.toThrow(); await expect(putExtensionRecord(profile,pkg.manifest,{ ...input,key:'bad',schemaId:'unknown' })).rejects.toThrow('未声明') })
  it('blocks foreign chapter references', async () => { const { profile, pkg } = await notes(); const other = await setup(); const chapterId = await db.chapters.add({ projectId: other.scope.projectId, workId: other.scope.workId, title:'other' } as never); await expect(putExtensionRecord(profile,pkg.manifest,{ key:'main',schemaId:'note',payload:{ text:'x' },expectedRevision:null,chapterId:chapterId as number })).rejects.toThrow('不属于') })
  it('roundtrips without executable packages and without automatic activation', async () => { const { profile, pkg, created } = await notes(); await putExtensionRecord(profile,pkg.manifest,{ key:'main',schemaId:'note',payload:{ text:'便携内容' },expectedRevision:null }); const backup = await deriveExportProjectJSON(created.project.id!); expect((backup as unknown as Record<string, unknown>).extensionPackages).toBeUndefined(); const imported = await deriveImportProjectJSON(backup); const newProfile = (await db.extensionProfiles.where('projectId').equals(imported).toArray())[0]; expect(newProfile.enabled).toBe(false); const newRecords = await db.extensionRecords.where('profileId').equals(newProfile.id!).toArray(); expect(newRecords[0].payload).toEqual({ text:'便携内容' }); expect(newRecords[0].workId).not.toBe(profile.workId); expect(newProfile.workId).toBe(newRecords[0].workId) })
  it('converts only complete v14 backups and refuses missing core tables', async () => { const { created } = await setup(); const backup = await deriveExportProjectJSON(created.project.id!) as unknown as Record<string, unknown> & { version:number }; backup.version = 14; for (const spec of PROJECT_TABLES.filter(s => s.introducedBackupVersion === 15)) delete backup[spec.name]; expect(inspectProjectBackup(backup).valid).toBe(true); const converted = normalizeProjectBackup(backup); expect(converted.version).toBe(15); expect(converted.extensionRecords).toEqual([]); expect(backup.extensionRecords).toBeUndefined(); delete backup.characters; expect(() => normalizeProjectBackup(backup)).toThrow('缺少') })
  it('migration commits a new generation and keeps the original; stale profile cannot migrate twice', async () => { const { profile, pkg } = await notes(); await putExtensionRecord(profile,pkg.manifest,{key:'main',schemaId:'note',payload:{text:'original'},expectedRevision:null}); await disablePackage(profile); const current = (await db.extensionProfiles.get(profile.id!))!; const zip = await JSZip.loadAsync(await bytes()); const manifest = { ...pkg.manifest, version:'2.0.0', schemas:{ note:{ ...pkg.manifest.schemas.note,version:2 } } }; zip.file('manifest.json',JSON.stringify(manifest)); const newer = await installPackage(await zip.generateAsync({type:'arraybuffer'})); await upgradePackage(current,newer,{activate(){},migrate(){return {text:'migrated'}}}); expect((await db.extensionProfiles.get(profile.id!))?.generation).toBe(2); expect((await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).map(row=>row.payload)).toEqual([{text:'original'},{text:'migrated'}]); await expect(upgradePackage(current,newer,{activate(){},migrate(){return {text:'bad'}}})).rejects.toThrow('配置已变化') })
})

describe('plugin generation flow composition', () => {
  it('compiles registered formal actions, snapshots them into the work and never starts AI', async () => {
    const { scope, created } = await setup()
    const pkg = await installPackage(await bytes('plot-flow'))
    const graph = compileExtensionFlow(pkg.manifest.flows![0])
    expect(graph.nodes.map(node => node.templateId)).toEqual(['story.conflict','story.main-plot'])
    await enablePackage(pkg, scope)
    const [{ profile }] = await activePackages(scope)
    const id = await createExtensionFlow({ scope, profileId:profile.id, pluginId:pkg.pluginId, digest:pkg.digest, kind:'workflow', instruction:'review', flowId:'conflict-to-plot' })
    expect((await db.nodeFlows.get(id))?.description).toContain(pkg.digest)
    expect(await db.agentRuns.count()).toBe(0)
    await disablePackage(profile); await uninstallPackage(pkg)
    expect((await db.nodeFlows.get(id))?.projectId).toBe(created.project.id)
  })
  it('rejects private record bindings and missing host node types', async () => {
    const { manifest } = await readPackage(await bytes('plot-flow'))
    const flow = structuredClone(manifest.flows![0]); flow.nodes[0].config.recordId = 999
    expect(() => compileExtensionFlow(flow)).toThrow('本地绑定')
    flow.nodes[0].config = {}; flow.nodes[0].templateId = 'private.unregistered'
    expect(() => compileExtensionFlow(flow)).toThrow('不支持')
  })
})


describe('plugin recovery and hostile input', () => {
  it('restores a historical generation without erasing edits made after upgrade', async () => {
    const { profile, pkg, scope, created } = await notes()
    await putExtensionRecord(profile, pkg.manifest, {key:'main',schemaId:'note',payload:{text:'first'},expectedRevision:null})
    await disablePackage(profile)
    const zip = await JSZip.loadAsync(await bytes())
    zip.file('manifest.json', JSON.stringify({...pkg.manifest,version:'1.1.0'}))
    const newer = await installPackage(await zip.generateAsync({type:'arraybuffer'}))
    await upgradePackage((await db.extensionProfiles.get(profile.id!))!, newer, {activate(){}})
    await enablePackage(newer, scope)
    const [{profile: active}] = await activePackages(scope)
    await putExtensionRecord(active, newer.manifest, {key:'main',schemaId:'note',payload:{text:'new edits'},expectedRevision:1})
    await expect(restoreGeneration(active,1)).rejects.toThrow('停用')
    await disablePackage(active)
    const stopped = (await db.extensionProfiles.get(profile.id!))!
    await restoreGeneration(stopped, 1)
    const restored = (await db.extensionProfiles.get(profile.id!))!
    expect(restored).toMatchObject({generation:3,digest:pkg.digest,enabled:false})
    expect((await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).map(row=>row.payload)).toEqual([{text:'first'},{text:'new edits'},{text:'first'}])
    await expect(restoreGeneration(stopped,1)).rejects.toThrow('变化')
    const backup = await deriveExportProjectJSON(created.project.id!)
    await expect(deriveImportProjectJSON(backup)).resolves.toBeTypeOf('number')
  })
  it('migration validation failure leaves old data and pointer untouched', async () => {
    const { profile, pkg } = await notes()
    await putExtensionRecord(profile,pkg.manifest,{key:'main',schemaId:'note',payload:{text:'keep'},expectedRevision:null})
    await disablePackage(profile)
    const stopped = (await db.extensionProfiles.get(profile.id!))!
    const zip = await JSZip.loadAsync(await bytes())
    zip.file('manifest.json',JSON.stringify({...pkg.manifest,version:'2.0.0',schemas:{note:{...pkg.manifest.schemas.note,version:2}}}))
    const newer = await installPackage(await zip.generateAsync({type:'arraybuffer'}))
    await expect(upgradePackage(stopped,newer,{activate(){},migrate(){return {wrong:true}}})).rejects.toThrow()
    expect(await db.extensionProfiles.get(profile.id!)).toEqual(stopped)
    expect(await db.extensionRecords.count()).toBe(1)
  })
  it('rejects tampered backup schemas, owner bindings and receipt generations before creating a project', async () => {
    const { profile, pkg, created } = await notes()
    await putExtensionRecord(profile,pkg.manifest,{key:'main',schemaId:'note',payload:{text:'keep'},expectedRevision:null})
    const backup = await deriveExportProjectJSON(created.project.id!)
    for (const mutate of [
      (value: typeof backup) => { value.extensionRecords[0].payload = {bad:true} },
      (value: typeof backup) => { value.extensionRecords[0].ownerKey = 'work:foreign' },
      (value: typeof backup) => { value.extensionOperations[0].toGeneration = 999 },
    ]) { const copy = structuredClone(backup); mutate(copy); await expect(deriveImportProjectJSON(copy)).rejects.toThrow(); expect(await db.projects.count()).toBe(1) }
  })
})


it('chapter deletion detaches plugin references; work deletion removes scoped records but keeps globally installed packages', async () => {
  const {profile,pkg,scope} = await notes()
  const chapterId = await db.chapters.add({projectId:scope.projectId,workId:scope.workId,worldId:null,title:'章',content:'正文'} as never)
  await putExtensionRecord(profile,pkg.manifest,{key:'main',schemaId:'note',payload:{text:'comment'},expectedRevision:null,chapterId})
  await cascadeDeleteChapterRecords([chapterId])
  expect((await db.extensionRecords.toArray())[0]).toMatchObject({chapterId:null,payload:{text:'comment'}})
  await deleteWork(scope.workId!)
  expect(await db.extensionProfiles.count()).toBe(0)
  expect(await db.extensionRecords.count()).toBe(0)
  expect(await db.extensionContracts.count()).toBe(0)
  expect(await db.extensionOperations.count()).toBe(0)
  expect(await db.extensionPackages.count()).toBe(1)
})


it('quota failure during migration rolls back new rows, profile pointer and operation receipt together', async () => {
 const {profile,pkg}=await notes()
 await putExtensionRecord(profile,pkg.manifest,{key:'main',schemaId:'note',payload:{text:'must survive'},expectedRevision:null})
 await disablePackage(profile)
 const stopped=(await db.extensionProfiles.get(profile.id!))!,beforeRows=await db.extensionRecords.toArray(),beforeOps=await db.extensionOperations.toArray()
 const zip=await JSZip.loadAsync(await bytes());zip.file('manifest.json',JSON.stringify({...pkg.manifest,version:'2.0.0'}))
 const newer=await installPackage(await zip.generateAsync({type:'arraybuffer'}))
 const write=vi.spyOn(db.extensionOperations,'add').mockRejectedValueOnce(new DOMException('isolated quota injection','QuotaExceededError'))
 try { await expect(upgradePackage(stopped,newer,{activate(){}})).rejects.toThrow('quota') } finally { write.mockRestore() }
 expect(await db.extensionProfiles.get(profile.id!)).toEqual(stopped)
 expect(await db.extensionRecords.toArray()).toEqual(beforeRows)
 expect(await db.extensionOperations.toArray()).toEqual(beforeOps)
})
