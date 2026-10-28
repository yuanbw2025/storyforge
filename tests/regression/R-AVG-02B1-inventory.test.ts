import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { avgInventoryFixture } from '../helpers/avg-inventory-fixture'
import { avgNativePackage, avgNativeScripts, seedAvgNativePreview } from '../helpers/avg-native-fixture'
import { parseAvgSystemPlan, parseAvgSystemPlanV1 } from '../../src/lib/avg/system-contract'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-compiler'
import { createProductRuntimeInstance, createProductInitialStateV1 } from '../../src/lib/product/runtime-instances'
import { appendProductRuntimeEvent, branchProductRuntimeSession, createProductRuntimeCheckpoint, readProductRuntimeState, readProductRuntimeStateVersion, commitNarrativeChoice } from '../../src/lib/product/runtime-core'
import { commitAvgInventoryActionV1 } from '../../src/lib/avg/inventory-commands'
import { projectAvgInventoryV1 } from '../../src/lib/avg/inventory-runtime'
import { avgInventoryValuesV1 } from '../../src/lib/avg/inventory-state'
import { compileAvgSystemPlanV1 } from '../../src/lib/avg/system-compiler'
import { previewAvgSystemEffectsV1 } from '../../src/lib/avg/system-state'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { parseProductRuntimePackageV2 } from '../../src/lib/product-production/runtime-package'

async function start(plan = avgInventoryFixture()) {
  const fixture = await seedAvgNativePreview(plan)
  const session = await createProductRuntimeInstance({ scope: fixture.scope, kind: 'avg', title: '物件与证据工程测试', productSource: { kind: 'build', productBuildId: fixture.buildId, expectedPreviewHash: fixture.preview.previewHash } })
  return { ...fixture, sessionId: session.id! }
}
async function command(sessionId: number, actionKey: string, commandId = crypto.randomUUID()) {
  const base = await readProductRuntimeStateVersion(sessionId)
  const target = ['presentLetter','giveLetter'].includes(actionKey) ? { kind: 'character' as const, key: 'keeper' } : null
  return { sessionId, actionKey, target, commandId, baseSequence: base.sequence, baseStateHash: base.stateHash }
}
describe('AVG optional inventory and evidence: real adoption, commands, player projection and saves', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('dispatches rule V2 explicitly, preserving V1 bytes/capabilities and default-hidden menus', async () => {
    const plan = avgInventoryFixture()
    expect(parseAvgSystemPlan(plan)).toEqual(plan)
    expect(() => parseAvgSystemPlanV1(plan)).toThrow(/V1/)
    const pkg = compileAvgExecutablePackageV2({ product: { key: 'test', title: 'test', description: '' }, systemPlan: plan, scripts: avgNativeScripts(plan), sourceWorld: avgNativePackage().sourceWorld, stage: { version: 1, assets: [], cues: [] }, aspectRatio: '16:9' })
    expect(pkg.definition.enabledCapabilities).toEqual(['narrative','presentation','avg.rules','avg.inventory'])
    expect(pkg.definition.rulesetVersion).toBe(2)
    expect(avgNativePackage().definition.rulesetVersion).toBe(1)
    expect(projectAvgInventoryV1(createProductInitialStateV1({ runtimePackage: avgNativePackage(), runtimeSourceHash: 'a'.repeat(64) }))).toEqual({ enabled: false, entries: [] })
    const s = await start(plan)
    expect((await readProductRuntimeState(s.sessionId)).avgRules?.systemPlan.version).toBe(2)
    const forged = structuredClone(pkg); forged.definition.enabledCapabilities.pop()
    expect(() => parseProductRuntimePackageV2(forged)).toThrow(/能力/)
  })
  it('rejects duplicate unique instances, unknown owners/targets/paths, invalid transitions and forged receipt effects', () => {
    for (const mutate of [
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.instances.push({ ...p.inventory.instances[0], key: 'duplicate' }) },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.instances[0].holderKey = 'stranger' },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.actions[1].target!.key = 'stranger' },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.actions[0].effects.push({ op: 'set', path: 'avg.inventory.instances.envelope.inspected', value: true }) },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.items[0].transitions[0].to = 'destroyed' },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.actions[0].once = false },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.instances[0].key = 'constructor' },
      (p: ReturnType<typeof avgInventoryFixture>) => { p.inventory.actions[0].effects[0].path = 'avg.inventory.instances.unknown.quantity' },
    ]) { const plan = avgInventoryFixture(); mutate(plan); expect(() => parseAvgSystemPlan(plan)).toThrow() }
  })
  it('rejects missing/wrong-kind item media before a package can claim executable inventory', () => {
    const plan = avgInventoryFixture(); plan.inventory.items[0].iconAssetKey = 'ui.letter'
    expect(() => compileAvgExecutablePackageV2({ product: { key: 'test', title: 'test', description: '' }, sourceWorld: avgNativePackage().sourceWorld,
      systemPlan: plan, scripts: avgNativeScripts(plan), stage: { version: 1, assets: [], cues: [] }, aspectRatio: '16:9' })).toThrow(/媒体/)
  })
  it('reads real item icon/detail bytes through the frozen catalog and remaps both bindings through backup', async () => {
    const plan = avgInventoryFixture(), media = await avgInventoryMediaFixture()
    plan.inventory.items[0].iconAssetKey = 'ui.envelope'
    plan.inventory.items[0].variants[0].iconAssetKey = 'ui.envelope'
    plan.inventory.items[0].variants[0].detailAssetKey = 'cg.seal-detail'
    const s = await seedAvgNativePreview(plan, media)
    const resolved = await resolveProductRuntimeSource({ scope: s.scope, source: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    expect(await (await resolved.mediaResolver.read('ui.envelope')).arrayBuffer()).toEqual(media[0].data)
    resolved.mediaResolver.dispose()
    await expect(resolved.mediaResolver.read('ui.envelope')).rejects.toThrow(/已释放/)
    const interrupted = await resolveProductRuntimeSource({ scope: s.scope, source: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    const pending = interrupted.mediaResolver.preload({ assetKeys: ['ui.envelope'], maximumBytes: 1_000_000 })
    interrupted.mediaResolver.dispose()
    const stopped = await pending
    expect(stopped.urls).toEqual({})
    expect(stopped.failures[0].reason).toMatch(/已释放/)
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(importedId).first())!
    const imported = await resolveProductRuntimeSource({ scope: { projectId: importedId, workId: build.workId!, worldId: build.worldId }, source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash! } })
    expect(await (await imported.mediaResolver.read('cg.seal-detail')).arrayBuffer()).toEqual(media[1].data)
    imported.mediaResolver.dispose()
  })
  it('gains an explicitly unheld unique instance once and rejects inspect side effects that consume an item', async () => {
    const plan = avgInventoryFixture()
    plan.inventory.instances[0].holderKey = '@none'; plan.inventory.instances[0].quantity = 0
    plan.inventory.actions.push({ ...plan.inventory.actions[0], key: 'gainLetter', verb: 'gain', effects: [
      { op: 'set', path: 'avg.inventory.instances.envelope.holder', value: 'player' },
      { op: 'set', path: 'avg.inventory.instances.envelope.quantity', value: 1 },
    ] })
    plan.inventory.actions[0].effects.push({ op: 'set', path: 'avg.inventory.instances.tokens.quantity', value: 2 })
    const s = await start(plan)
    expect(projectAvgInventoryV1(await readProductRuntimeState(s.sessionId)).entries.map(i => i.instanceKey)).toEqual(['tokens'])
    await commitAvgInventoryActionV1(await command(s.sessionId, 'gainLetter'))
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'gainLetter'))).rejects.toThrow(/不可用/)
    const before = await readProductRuntimeState(s.sessionId), count = await db.productRuntimeEvents.count()
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))).rejects.toThrow(/查看不能改变/)
    expect(await readProductRuntimeState(s.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('keeps hidden/other-held item and unknown detail payloads out of the player projection', async () => {
    const s = await start(), before = await readProductRuntimeState(s.sessionId)
    const publicView = projectAvgInventoryV1(before)
    expect(publicView.entries.map(i => i.name)).toEqual(['封好的信封','通行票'])
    expect(JSON.stringify(publicView)).not.toMatch(/旧缺口|不应泄露|knowledge|feedback/)
    expect(publicView.entries[0].actions.find(a => a.key === 'presentLetter')?.enabled).toBe(false)
    await commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))
    const after = await readProductRuntimeState(s.sessionId)
    expect(projectAvgInventoryV1(after).entries[0]).toMatchObject({ name: '带缺口的封印信', inspected: true })
    expect(projectAvgInventoryV1(after).entries[0].actions.some(a => a.key === 'inspectLetter')).toBe(false)
    expect(after.narrative?.variables).toMatchObject({ avg: { knowledge: { player: { seal: true }, keeper: { seal: false } }, variables: { attempts: 1 } } })
  })
  it('commits once, preserves stage/visit/beat, refreshes choices and refuses replayed rewards or changed command identity', async () => {
    const s = await start(), base = await readProductRuntimeStateVersion(s.sessionId)
    await reachAvgPresentationBeat({ sessionId: s.sessionId, beatKey: 'line.desk', commandId: 'read', baseSequence: base.sequence, baseStateHash: base.stateHash })
    const before = await readProductRuntimeState(s.sessionId), input = await command(s.sessionId, 'inspectLetter', 'inspect.once')
    const event = await commitAvgInventoryActionV1(input)
    expect((await commitAvgInventoryActionV1(input)).id).toBe(event.id)
    const after = await readProductRuntimeState(s.sessionId)
    expect(after.presentation).toEqual(before.presentation)
    expect(after.narrative?.visitedNodeKeys).toEqual(before.narrative?.visitedNodeKeys)
    expect(after.narrative?.lastEnteredNodeSequence).toBe(before.narrative?.lastEnteredNodeSequence)
    expect(after.narrative?.choiceHistory).toEqual([])
    expect(after.narrative?.availableChoiceKeys).toContain('share')
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))).rejects.toThrow(/已完成/)
    await expect(commitAvgInventoryActionV1({ ...input, actionKey: 'openLetter' })).rejects.toThrow(/commandId/)
    expect((await readProductRuntimeState(s.sessionId)).narrative?.variables).toMatchObject({ avg: { variables: { attempts: 1 } } })
  })
  it('rejects wrong targets, unavailable actions, stale concurrency and generic event bypass atomically', async () => {
    const s = await start(), priorCount = await db.productRuntimeEvents.count()
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'presentLetter'))).rejects.toThrow(/不可用/)
    const wrong = await command(s.sessionId, 'inspectLetter'); wrong.target = { kind: 'character', key: 'keeper' }
    await expect(commitAvgInventoryActionV1(wrong)).rejects.toThrow(/目标/)
    await expect(appendProductRuntimeEvent({ sessionId: s.sessionId, type: 'avg.inventory.action.committed', payload: { actionKey: 'inspectLetter', target: null } })).rejects.toThrow(/专用/)
    expect(await db.productRuntimeEvents.count()).toBe(priorCount)
    const first = await command(s.sessionId, 'inspectLetter'), stale = await command(s.sessionId, 'useToken')
    await commitAvgInventoryActionV1(first)
    await expect(commitAvgInventoryActionV1(stale)).rejects.toThrow(/状态已变化/)
    expect(avgInventoryValuesV1((await readProductRuntimeState(s.sessionId)).narrative!.variables).instances.tokens.quantity).toBe(3)
  })
  it('presents without consuming, then transfers exactly once and removes the item from the player view', async () => {
    const s = await start()
    await commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))
    await commitAvgInventoryActionV1(await command(s.sessionId, 'presentLetter'))
    let state = await readProductRuntimeState(s.sessionId)
    expect(avgInventoryValuesV1(state.narrative!.variables).instances.envelope).toMatchObject({ holder: 'player', quantity: 1 })
    expect(state.narrative?.variables).toMatchObject({ avg: { knowledge: { keeper: { seal: true } } } })
    await commitAvgInventoryActionV1(await command(s.sessionId, 'giveLetter'))
    state = await readProductRuntimeState(s.sessionId)
    expect(avgInventoryValuesV1(state.narrative!.variables).instances.envelope.holder).toBe('keeper')
    expect(projectAvgInventoryV1(state).entries.map(i => i.instanceKey)).not.toContain('envelope')
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'giveLetter'))).rejects.toThrow()
  })
  it('handles stacks/removal and rejects quantity overflow, incoherent holder updates and illegal state rollback', async () => {
    const s = await start()
    await commitAvgInventoryActionV1(await command(s.sessionId, 'openLetter'))
    await commitAvgInventoryActionV1(await command(s.sessionId, 'useToken'))
    await commitAvgInventoryActionV1(await command(s.sessionId, 'useToken'))
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'useToken'))).rejects.toThrow(/不可用/)
    await commitAvgInventoryActionV1(await command(s.sessionId, 'removeToken'))
    const state = await readProductRuntimeState(s.sessionId), values = state.narrative!.variables
    expect(avgInventoryValuesV1(values).instances.tokens).toMatchObject({ quantity: 0, holder: '@none' })
    expect(projectAvgInventoryV1(state).entries.map(i => i.instanceKey)).toEqual(['envelope'])
    for (const effects of [
      [{ op: 'set' as const, path: 'avg.inventory.instances.envelope.state', value: 'sealed' }],
      [{ op: 'set' as const, path: 'avg.inventory.instances.tokens.quantity', value: 4 }],
      [{ op: 'set' as const, path: 'avg.inventory.instances.envelope.holder', value: '@none' }],
    ]) expect(() => previewAvgSystemEffectsV1(s.runtimePackage.modules[0].version === 2 ? s.runtimePackage.modules[0].systemPlan : avgInventoryFixture(), values, effects)).toThrow()
  })
  it('checks initial coherence and per-effect range before a canceling pair can hide overflow', async () => {
    const plan = avgInventoryFixture(), { initialVariables } = await compileAvgSystemPlanV1(plan)
    expect(() => previewAvgSystemEffectsV1(plan, initialVariables, [{ op: 'increment', path: 'avg.inventory.instances.tokens.quantity', value: 1 }, { op: 'increment', path: 'avg.inventory.instances.tokens.quantity', value: -1 }])).toThrow()
    plan.inventory.instances[0].quantity = 0
    await expect(compileAvgSystemPlanV1(plan)).rejects.toThrow(/持有人/)
  })
  it('restores inventory, knowledge and once receipts through a real checkpoint/fork/backup and deletes only the imported owner', async () => {
    const s = await start()
    await commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId: s.sessionId, name: '检查后的物件' })
    await commitAvgInventoryActionV1(await command(s.sessionId, 'presentLetter'))
    await commitAvgInventoryActionV1(await command(s.sessionId, 'giveLetter'))
    const child = await branchProductRuntimeSession({ parentSessionId: s.sessionId, throughSequence: checkpoint.throughSequence, title: '回到检查之后' })
    expect(projectAvgInventoryV1(await readProductRuntimeState(child.id!)).entries[0].name).toBe('带缺口的封印信')
    await expect(commitAvgInventoryActionV1(await command(child.id!, 'inspectLetter'))).rejects.toThrow(/已完成/)
    await commitAvgInventoryActionV1(await command(child.id!, 'presentLetter'))
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(row => row.parentSessionId != null)!
    expect(projectAvgInventoryV1(await readProductRuntimeState(restored.id!))).toEqual(projectAvgInventoryV1(await readProductRuntimeState(child.id!)))
    await deleteWork(importedId, restored.workId!)
    expect(await db.productRuntimeEvents.where('sessionId').equals(restored.id!).count()).toBe(0)
    expect(await db.productRuntimeSessions.get(s.sessionId)).toBeDefined()
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('cannot use inventory once an ending is entered', async () => {
    const s = await start(), base = await readProductRuntimeStateVersion(s.sessionId)
    await reachAvgPresentationBeat({ sessionId: s.sessionId, beatKey: 'line.desk', commandId: 'read.ending', baseSequence: base.sequence, baseStateHash: base.stateHash })
    const choiceBase = await readProductRuntimeStateVersion(s.sessionId)
    await commitNarrativeChoice({ sessionId: s.sessionId, choiceKey: 'wait', commandId: 'choose.ending', baseSequence: choiceBase.sequence, baseStateHash: choiceBase.stateHash })
    await expect(commitAvgInventoryActionV1(await command(s.sessionId, 'inspectLetter'))).rejects.toThrow(/不可用/)
  })
})
