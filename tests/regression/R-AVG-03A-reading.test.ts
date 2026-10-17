import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgReadingFixture, avgReadingAudioFixture, seedAvgReadingPreview } from '../helpers/avg-reading-fixture'
import { avgNativePackage, avgNativeScripts } from '../helpers/avg-native-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-compiler'
import { parseProductRuntimePackageV2 } from '../../src/lib/product-production/runtime-package'
import { avgExecutableModule } from '../../src/lib/avg/executable-module'
import { createProductInitialStateV1, createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { commitAvgVoiceCommandV1 } from '../../src/lib/avg/reading-commands'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { avgVoiceReadyV1 } from '../../src/lib/avg/reading-runtime'
import { appendProductRuntimeEvent, branchProductRuntimeSession, commitNarrativeChoice, createProductRuntimeCheckpoint, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

async function start(overrides: Parameters<typeof seedAvgReadingPreview>[0] = {}) {
  const s = await seedAvgReadingPreview(overrides)
  const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '阅读协调隔离', productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
  return { ...s, sessionId: session.id! }
}
async function base(sessionId: number) { const b = await readProductRuntimeStateVersion(sessionId); return { sessionId, baseSequence: b.sequence, baseStateHash: b.stateHash, commandId: crypto.randomUUID() } }
async function begin(id: number, visit = 0) { return commitAvgVoiceCommandV1({ ...await base(id), type: 'start', lineKey: 'line.desk', visit }) }
async function observe(id: number, outcome: 'ended' | 'failed' | 'interrupted', generation = 'play.1', visit = 0) {
  return commitAvgVoiceCommandV1({ ...await base(id), type: 'observe', lineKey: 'line.desk', visit, generation, outcome, playedMs: 0, reason: outcome === 'ended' ? '' : '真实观察测试' })
}
async function read(id: number) { return reachAvgPresentationBeat({ ...await base(id), beatKey: 'line.desk' }) }
describe('AVG native reading protocol and durable playback/history', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('requires exact text/revision/speaker/locale/audio bindings and never upgrades old state bytes', async () => {
    expect(createProductInitialStateV1({ runtimePackage: avgNativePackage(), runtimeSourceHash: 'a'.repeat(64) })).not.toHaveProperty('avgReading')
    const media = await avgReadingAudioFixture()
    const build = (reading = avgReadingFixture()) => compileAvgExecutablePackageV2({ product: { key: 'reading', title: 'reading', description: '' }, sourceWorld: avgNativePackage().sourceWorld,
      systemPlan: avgSystemFixture(), scripts: avgNativeScripts(), stage: { version: 1, cues: [], assets: [media.asset] }, aspectRatio: '16:9', reading })
    const pkg = build(); expect(pkg.definition.enabledCapabilities).toContain('avg.reading')
    for (const field of ['text','textRevision','speakerKey','locale','assetKey']) {
      const reading = avgReadingFixture(); (reading.voices[0] as any)[field] = field === 'textRevision' ? 2 : 'wrong'
      expect(() => build(reading)).toThrow()
    }
    const mismatch = structuredClone(pkg); mismatch.definition.enabledCapabilities.pop()
    expect(() => parseProductRuntimePackageV2(mismatch)).toThrow(/能力/)
    const duplicate = structuredClone(pkg)
    avgExecutableModule(duplicate)!.stage.cues.push({ cueKey: 'duplicate.voice', beatKey: 'line.desk', type: 'play-audio', assetKey: media.asset.assetKey, phase: 'before', durationMs: 0, order: 0, easing: 'linear' })
    expect(() => parseProductRuntimePackageV2(duplicate)).toThrow(/重复播放/)
    const looping = structuredClone(pkg), m = avgExecutableModule(looping)!
    m.stage.assets.push({ ...media.asset, kind: 'sfx', assetKey: 'sfx.bad-loop' })
    m.stage.cues.push({ cueKey: 'sfx.loop', beatKey: 'line.desk', type: 'play-audio', assetKey: 'sfx.bad-loop', loop: true, phase: 'before', durationMs: 0, order: 0, easing: 'linear' })
    expect(() => parseProductRuntimePackageV2(looping)).toThrow(/不可循环/)
  })
  it('blocks settled text before actual ended, records request separately and makes identical commands idempotent', async () => {
    const s = await start(), input = { ...await base(s.sessionId), type: 'start' as const, lineKey: 'line.desk', visit: 0 }
    expect(avgVoiceReadyV1(await readProductRuntimeState(s.sessionId))).toBe(false)
    await expect(read(s.sessionId)).rejects.toThrow(/尚未结束/)
    const e = await commitAvgVoiceCommandV1(input)
    expect((await commitAvgVoiceCommandV1(input)).id).toBe(e.id)
    expect((await readProductRuntimeState(s.sessionId)).avgReading?.current?.status).toBe('requested')
    await expect(read(s.sessionId)).rejects.toThrow(/尚未结束/)
    await observe(s.sessionId,'ended')
    await read(s.sessionId)
    expect((await readProductRuntimeState(s.sessionId)).avgReading?.history[0]).toMatchObject({ kind: 'line', index: 0, visit: 0, text: '封口仍在。', textRevision: 1, speaker: '保管员', voiceOutcome: 'ended' })
  })
  it('rejects stale generations/visits, generic bypass and forbidden interruption without partial events', async () => {
    const s = await start(); await begin(s.sessionId); await begin(s.sessionId)
    const count = await db.productRuntimeEvents.count()
    await expect(observe(s.sessionId,'ended','play.1')).rejects.toThrow(/generation/)
    await expect(observe(s.sessionId,'ended','play.2',1)).rejects.toThrow(/过期/)
    await expect(observe(s.sessionId,'interrupted','play.2')).rejects.toThrow(/未允许/)
    await expect(appendProductRuntimeEvent({ sessionId: s.sessionId, type: 'avg.reading.voice.observed', payload: {} })).rejects.toThrow(/专用/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    await observe(s.sessionId,'ended','play.2')
    await expect(observe(s.sessionId,'ended','play.2')).rejects.toThrow(/已终结/)
  })
  it('honors fail-closed pause, a new retry generation and explicitly allowed failure continuation', async () => {
    const s = await start(); await begin(s.sessionId); await observe(s.sessionId,'failed')
    await expect(read(s.sessionId)).rejects.toThrow(/尚未结束/)
    await begin(s.sessionId); await observe(s.sessionId,'ended','play.2'); await read(s.sessionId)
    const other = await start({ voiceFailure: 'continue' }); await begin(other.sessionId); await observe(other.sessionId,'failed'); await read(other.sessionId)
    expect((await readProductRuntimeState(other.sessionId)).avgReading?.history[0]).toMatchObject({ voiceOutcome: 'failed' })
  })
  it('records actual repeated visits and choices in order and restores voice/history through checkpoint/fork/backup', async () => {
    const s = await start({ manualVoice: 'interrupt' })
    await begin(s.sessionId); await observe(s.sessionId,'interrupted'); await read(s.sessionId)
    await commitNarrativeChoice({ ...await base(s.sessionId), choiceKey: 'inspect' })
    await begin(s.sessionId,1); await observe(s.sessionId,'ended','play.2',1)
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId: s.sessionId, name: '声音结束，尚未翻句' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.sessionId, throughSequence: checkpoint.throughSequence, title: '恢复阅读' })
    expect(avgVoiceReadyV1(await readProductRuntimeState(child.id!))).toBe(true)
    await read(child.id!)
    const state = await readProductRuntimeState(child.id!)
    expect(state.avgReading?.history.map(h => [h.kind,h.visit,h.text])).toEqual([['line',0,'封口仍在。'],['choice',0,'检查封口'],['line',1,'封口仍在。']])
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(r => r.parentSessionId != null)!
    expect((await readProductRuntimeState(restored.id!)).avgReading).toEqual(state.avgReading)
    await deleteWork(importedId, restored.workId!)
    expect(await db.productRuntimeSessions.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.productRuntimeSessions.get(s.sessionId)).toBeDefined()
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('refuses missing/replaced reading state in portable imports before any write', async () => {
    const s = await start(), snapshot = await exportProjectJSON(s.scope.projectId), count = await db.projects.count()
    for (const remove of [true,false]) {
      const forged = structuredClone(snapshot), row = forged.productRuntimeSessions![0], initial = JSON.parse(row.initialStateJson)
      if (remove) delete initial.avgReading; else initial.avgReading.plan.manualVoice = 'interrupt'
      row.initialStateJson = JSON.stringify(initial)
      await expect(importProjectJSON(forged)).rejects.toThrow(/冻结来源/)
      expect(await db.projects.count()).toBe(count)
    }
  })
})
