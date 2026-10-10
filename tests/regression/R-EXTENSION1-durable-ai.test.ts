import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { activePackages, disablePackage, enablePackage, extensionScope, installPackage, putExtensionRecord, uninstallPackage } from '../../src/lib/extensions/store'
import { domainScope } from '../../src/lib/extensions/domain'
import { adoptExtensionCandidate, cancelExtensionCandidate, generateExtensionCandidate, readExtensionCandidate, saveExtensionDraft } from '../../src/lib/extensions/ai-run'
import { adopt } from '../../src/lib/registry/adopt'
import { freezeExtensionRegistry } from '../../src/lib/extensions/ai-registry'
import type { ExtensionManifest } from '../../src/lib/extensions/types'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { assembleContext } from '../../src/lib/registry/assemble-context'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function setup() {
  const { project } = await createWorkspace({ name: 'AI 插件验收', description: '', genres: [], status: 'drafting', targetWordCount: 30000 }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const scope = await extensionScope(project.id!, 'work')
  const manifest: ExtensionManifest = { format: 1, api: 1, id: 'test.candidate', version: '1.0.0', name: '测试候选', description: '独立生成', author: 'test', license: 'MIT', kind: 'feature', owner: 'work', entry: 'main.js', dependencies: {}, permissions: ['data','ai.tasks'], networkOrigins: [], views: [], schemas: { note: { version: 1, schema: { type: 'object', properties: { text: { type:'string',minLength:1 } }, required:['text'], additionalProperties:false } } }, provides: [], consumes: [], aiTasks: [{id:'draft',title:'生成便笺',instruction:'提出一个创作建议',outputSchema:'note',contextSources:[]}] }
  const zip = new JSZip().file('manifest.json',JSON.stringify(manifest)).file('main.js','export default () => ({activate(){}})')
  const pkg = await installPackage(await zip.generateAsync({type:'arraybuffer'})); await enablePackage(pkg,scope)
  const [{profile}] = await activePackages(scope)
  return { profile, pkg, scope: await domainScope(profile) }
}
describe('R-EXTENSION1 durable plugin AI', () => {
  it('omits plugin context for ordinary calls even with an installed active plugin', async () => {
    const { scope } = await setup()
    const result = await assembleContext({ projectId: scope.projectId, scope, sourceKeys: ['extensionRecords'] })
    expect(result.text).toBe('')
    expect(result.omitted).toContain('extensionRecords')
  })
  it('imports pending and completed candidates as readable history without restoring write authority', async () => {
    const { profile, scope } = await setup()
    const first = await generateExtensionCandidate({ profileId: profile.id!, taskId: 'draft', recordKey: 'done', instruction: '', runAI: async () => '{"text":"已完成"}' })
    await adoptExtensionCandidate(scope, first.snapshot.run.id, '{"text":"作者确认"}')
    const pending = await generateExtensionCandidate({ profileId: profile.id!, taskId: 'draft', recordKey: 'pending', instruction: '', runAI: async () => '{"text":"待确认"}' })
    await saveExtensionDraft(scope, pending.snapshot.run.id, '{"text":"保留编辑"}')
    const imported = await deriveImportProjectJSON(await deriveExportProjectJSON(scope.projectId))
    const importedScope = await domainScope((await db.extensionProfiles.where('projectId').equals(imported).toArray())[0])
    const runs = await db.agentRuns.where('projectId').equals(imported).sortBy('id')
    const completed = await readExtensionCandidate(importedScope, runs[0].id!)
    expect(completed.historicalOnly).toBe(true); expect(completed.adopted).toContain('作者确认')
    expect((await readExtensionCandidate(importedScope, runs[1].id!)).draft).toContain('保留编辑')
    await expect(adoptExtensionCandidate(importedScope, runs[0].id!, '{"text":"不能写"}')).rejects.toThrow('历史副本')
    await expect(saveExtensionDraft(importedScope, runs[1].id!, '{}')).rejects.toThrow('历史副本')
    await expect(readExtensionCandidate(scope, runs[0].id!)).rejects.toThrow()
    expect((await readExtensionCandidate(scope, pending.snapshot.run.id)).historicalOnly).toBe(false)
    expect(await db.extensionRecords.where('projectId').equals(imported).count()).toBe(1)
  })
  it('freezes public task/schema, persists author edits, adopts atomically and reads after uninstall without code', async () => {
    const {profile,pkg,scope} = await setup(), runAI = vi.fn(async () => '{"text":"模型候选"}')
    const {snapshot,candidate} = await generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'main',instruction:'写灯塔',runAI})
    expect(candidate.artifact.status).toBe('ready'); expect(await db.extensionRecords.count()).toBe(0)
    expect(snapshot.contract.executionBindings?.[0].version).toBe(2)
    await saveExtensionDraft(scope,snapshot.run.id,'{"text":"作者修改"}')
    expect((await readExtensionCandidate(scope,snapshot.run.id)).draft).toContain('作者修改')
    const adopted = await adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"作者修改"}')
    expect(adopted.projection.state).toBe('completed'); expect(adopted.projection.terminalReceiptHash).toHaveLength(64)
    await adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"重复点击不能改写"}')
    expect((await db.extensionRecords.toArray())[0].payload).toEqual({text:'作者修改'})
    expect(runAI).toHaveBeenCalledTimes(1)
    await disablePackage(profile); await uninstallPackage(pkg)
    expect((await readExtensionCandidate(scope,snapshot.run.id)).adopted).toContain('作者修改')
  })
  it('unknown result and cancellation never cause hidden retry; malformed JSON remains editable', async () => {
    const {profile,scope} = await setup(), fail = vi.fn(async () => { throw new Error('network unknown') })
    await expect(generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'main',instruction:'',runAI:fail})).rejects.toThrow('unknown')
    expect(fail).toHaveBeenCalledTimes(1)
    const [run] = await db.agentRuns.toArray(); expect(run.status).toBe('paused')
    await expect(readExtensionCandidate(scope,run.id!)).rejects.toThrow('不会自动')
    const {snapshot,candidate} = await generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'main',instruction:'',runAI:async()=>'{broken'})
    expect(candidate.artifact.status).toBe('manual-repair')
    await expect(adoptExtensionCandidate(scope,snapshot.run.id,'{}')).rejects.toThrow()
    expect(await db.extensionRecords.count()).toBe(0)
    await adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"人工修复"}')
    const second = await generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'second',instruction:'',runAI:async()=>'{"text":"a"}'})
    await cancelExtensionCandidate(scope,second.snapshot.run.id)
    await expect(adoptExtensionCandidate(scope,second.snapshot.run.id,'{"text":"x"}')).rejects.toThrow('确认状态')
  })
  it('rejects changed source/profile, forged scope and unbound generic adoption', async () => {
    const {profile,pkg,scope} = await setup()
    const {snapshot} = await generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'main',instruction:'',runAI:async()=>'{"text":"a"}'})
    await putExtensionRecord(profile,pkg.manifest,{key:'other',schemaId:'note',payload:{text:'new source'},expectedRevision:null})
    await expect(adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"x"}')).rejects.toThrow('资料已改变')
    await expect(adopt({projectId:scope.projectId,scope,target:'extensionRecords',mode:'add',data:{payload:{text:'bypass'}}})).rejects.toThrow('冻结任务')
    const frozen = await freezeExtensionRegistry(profile.id!,'draft','main')
    frozen.recordKey='tampered'
    await expect(adopt({projectId:scope.projectId,scope,target:'extensionRecords',mode:'add',data:{payload:{text:'bypass'}},extensionSnapshot:frozen})).rejects.toThrow('校验失败')
    await disablePackage(profile)
    await expect(adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"x"}')).rejects.toThrow('变化')
    expect((await db.agentRuns.get(snapshot.run.id))?.status).toBe('awaiting_confirmation')
  })
  it('rolls back both author write and receipt on storage failure and safely retries the same candidate', async () => {
    const {profile,scope} = await setup()
    const {snapshot} = await generateExtensionCandidate({profileId:profile.id!,taskId:'draft',recordKey:'main',instruction:'',runAI:async()=>'{"text":"a"}'})
    const spy = vi.spyOn(db.extensionRecords,'put').mockRejectedValueOnce(new DOMException('quota','QuotaExceededError'))
    await expect(adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"x"}')).rejects.toThrow('quota')
    expect(await db.extensionRecords.count()).toBe(0); expect((await db.agentRuns.get(snapshot.run.id))?.status).toBe('awaiting_confirmation')
    spy.mockRestore()
    const results = await Promise.all([adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"x"}'),adoptExtensionCandidate(scope,snapshot.run.id,'{"text":"x"}')])
    expect(results.every(result=>result.projection.state==='completed')).toBe(true); expect(await db.extensionRecords.count()).toBe(1)
  })
})
