import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAvgMediaAsset, importAvgMediaAsset, publishAvgGame, seedAvgAcceptanceGame, updateAvgPresentation, validateAvgGame } from '../../src/lib/avg/authoring'
import { applyAvgCue, EMPTY_AVG_STAGE, parseAvgPresentationContent, validateAvgPresentation } from '../../src/lib/avg/runtime'
import { db } from '../../src/lib/db/schema'
import { appendSimulationEvent, branchSimulationSession, commitNarrativeChoice, reachAvgPresentationBeat, readSimulationState, readSimulationStateVersion, recordAvgMediaFailure, replaySimulationEvents } from '../../src/lib/simulation/runtime'
import { parseAvgGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createAvgGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import type { AvgPresentationCue, FrozenAvgMediaAsset } from '../../src/lib/types'

async function workspace(name: string) {
  const now = Date.now(); const projectId = await db.projects.add({ name, genre: 'visual-novel', genres: ['visual-novel'], status: 'drafting', description: '', targetWordCount: 20_000, createdAt: now, updatedAt: now } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

async function reach(sessionId: number, beatKey: string) {
  const base = await readSimulationStateVersion(sessionId)
  return reachAvgPresentationBeat({ sessionId, beatKey, commandId: `reach.${beatKey}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
}

describe('AVG-1 · governed visual narrative', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('只接受声明式白名单 Cue，并诊断断链、格式、替代文本与长等待', () => {
    const bad = parseAvgPresentationContent({ version: 1, cues: [{ cueKey: 'wait.long', beatKey: 'missing', phase: 'before', type: 'wait', durationMs: 12_000, easing: 'linear', order: 0 }] })
    const assets: FrozenAvgMediaAsset[] = [{ assetKey: 'bad-bg', version: 1, kind: 'background', name: '坏背景', mimeType: 'text/plain', byteSize: 2, width: null, height: null, durationMs: null, contentHash: 'a'.repeat(64), source: '', license: '', altText: '', characterTag: '', sceneTag: '' }]
    const report = validateAvgPresentation({ content: bad, beats: [], assets, allWorkAssets: assets })
    expect(report.valid).toBe(false); expect(report.orphanCueKeys).toEqual(['wait.long']); expect(report.unsupportedMimeAssetKeys).toEqual(['bad-bg']); expect(report.missingAltTextAssetKeys).toEqual(['bad-bg']); expect(report.longWaitCueKeys).toEqual(['wait.long'])
    expect(() => parseAvgPresentationContent({ version: 1, cues: [{ cueKey: 'x', beatKey: 'b', phase: 'before', type: 'script', durationMs: 0, easing: 'linear', order: 0 }] })).toThrow('Cue 类型无效')
  })

  it('八类 Cue 更新舞台但从不拥有 Narrative 变量或跳转', () => {
    const asset = (assetKey: string, kind: FrozenAvgMediaAsset['kind']): FrozenAvgMediaAsset => ({ assetKey, version: 1, kind, name: assetKey, mimeType: kind === 'bgm' ? 'audio/wav' : 'image/png', byteSize: 1, width: null, height: null, durationMs: null, contentHash: 'b'.repeat(64), source: '', license: '', altText: '替代文本', characterTag: '', sceneTag: '' })
    const assets = [asset('bg', 'background'), asset('actor', 'character-pose'), asset('cg', 'cg'), asset('overlay', 'ui'), asset('music', 'bgm')]
    const cue = (type: AvgPresentationCue['type'], extra: Partial<AvgPresentationCue> = {}): AvgPresentationCue => ({ cueKey: `c.${type}`, beatKey: 'b', phase: 'before', type, assetKey: null, actorKey: null, slot: null, layer: null, x: null, y: null, scale: null, opacity: null, tone: null, durationMs: 0, easing: 'linear', volume: null, loop: false, snapshotKey: null, order: 0, ...extra })
    let stage = structuredClone(EMPTY_AVG_STAGE)
    for (const item of [cue('set-background', { assetKey: 'bg' }), cue('set-overlay', { assetKey: 'overlay' }), cue('show-actor', { assetKey: 'actor', actorKey: 'lin', slot: 'left' }), cue('move-actor', { actorKey: 'lin', x: .5, scale: 1.2 }), cue('play-audio', { assetKey: 'music', loop: true }), cue('camera', { scale: 1.3 }), cue('shake'), cue('flash'), cue('show-cg', { assetKey: 'cg' })]) stage = applyAvgCue(stage, item, assets, {})
    expect(stage).toMatchObject({ backgroundAssetKey: 'bg', overlayAssetKey: 'overlay', cgAssetKey: 'cg', camera: { scale: 1.3 }, lastTransition: 'flash' }); expect(stage.actors[0]).toMatchObject({ actorKey: 'lin', x: .5, scale: 1.2 }); expect(stage.activeAudio[0]).toMatchObject({ channel: 'bgm', loop: true })
  })

  it('发布冻结媒资版本，Beat/Choice 事件回放、幂等与分支恢复完全一致', async () => {
    const owned = await workspace('AVG 核心'); const definition = await seedAvgAcceptanceGame({ scope: owned.scope })
    expect(await validateAvgGame(owned.scope, definition.id!)).toMatchObject({ valid: true })
    const publication = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseAvgGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.narrative.nodes.length).toBeGreaterThanOrEqual(25); expect(manifest.narrative.beats.length).toBeGreaterThanOrEqual(45)
    expect(manifest.presentation.assets.filter(asset => asset.kind === 'background')).toHaveLength(5)
    expect(manifest.presentation.assets.filter(asset => asset.kind === 'character-pose')).toHaveLength(9)
    expect(manifest.presentation.assets.filter(asset => asset.kind === 'cg')).toHaveLength(3)
    expect(new Set(manifest.presentation.assets.filter(asset => ['bgm', 'ambience', 'sfx', 'voice'].includes(asset.kind)).map(asset => asset.kind)).size).toBe(4)
    expect(manifest.presentation.cues.map(cue => cue.type)).toEqual(expect.arrayContaining(['set-background', 'show-actor', 'hide-actor', 'play-audio', 'camera', 'shake', 'flash', 'show-cg']))
    const session = await createAvgGameInstance({ scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '演出存档' })
    const initial = await readSimulationState(session.id!); expect(initial.narrative?.variables).toEqual({ clue: false, trust: 0, light: 0 }); expect(initial.presentation?.stage.backgroundAssetKey).toBeNull()
    await expect(appendSimulationEvent({ sessionId: session.id!, type: 'presentation.beat.reached', payload: { beatKey: 'ch1.entry.beat-1' } })).rejects.toThrow('专用命令')
    const firstBase = await readSimulationStateVersion(session.id!); const first = await reachAvgPresentationBeat({ sessionId: session.id!, beatKey: 'ch1.entry.beat-1', commandId: 'reach.ch1.entry.beat-1', baseSequence: firstBase.sequence, baseStateHash: firstBase.stateHash })
    expect(await reachAvgPresentationBeat({ sessionId: session.id!, beatKey: 'ch1.entry.beat-1', commandId: 'reach.ch1.entry.beat-1', baseSequence: firstBase.sequence, baseStateHash: firstBase.stateHash })).toEqual(first)
    let state = await readSimulationState(session.id!); expect(state.presentation?.stage.backgroundAssetKey).toBe('bg.harbor-night'); expect(state.narrative?.variables).toEqual({ clue: false, trust: 0, light: 0 })
    let base = await readSimulationStateVersion(session.id!); await expect(commitNarrativeChoice({ sessionId: session.id!, choiceKey: 'ch1.seek-archive', commandId: 'too-early', baseSequence: base.sequence, baseStateHash: base.stateHash })).rejects.toThrow('读完')
    await reach(session.id!, 'ch1.entry.beat-2'); base = await readSimulationStateVersion(session.id!); await commitNarrativeChoice({ sessionId: session.id!, choiceKey: 'ch1.seek-archive', commandId: 'choice.entry', baseSequence: base.sequence, baseStateHash: base.stateHash })
    await reach(session.id!, 'ch1.archive.beat-1'); await reach(session.id!, 'ch1.archive.beat-2')
    state = await readSimulationState(session.id!); expect(state.presentation?.stage.backgroundAssetKey).toBe('bg.archive'); expect(state.presentation?.stage.actors[0]).toMatchObject({ actorKey: 'lin', slot: 'left' })
    const events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence'); expect(replaySimulationEvents(JSON.parse(session.initialStateJson), events)).toEqual(state)
    const child = await branchSimulationSession({ parentSessionId: session.id!, throughSequence: state.lastSequence, title: '演出分支' }); const childState = await readSimulationState(child.id!); expect(childState.presentation?.stage).toEqual(state.presentation?.stage); expect(childState.lastSequence).toBe(0)
  }, 30_000)

  it('媒资替换生成新版本，旧发布 hash 不变且引用版本阻止硬删除', async () => {
    const owned = await workspace('AVG 版本'); const definition = await seedAvgAcceptanceGame({ scope: owned.scope }); const first = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! }); const originalHash = first.gameRelease.contentHash
    const replacement = await importAvgMediaAsset({ scope: owned.scope, assetKey: 'bg.harbor-night', kind: 'background', name: '新港口', blob: new Blob(['new-background'], { type: 'image/png' }), altText: '新港口背景' })
    expect(replacement.version).toBe(2); expect((await db.gameReleases.get(first.gameRelease.id!))?.contentHash).toBe(originalHash)
    const old = await db.avgMediaAssets.where('workId').equals(owned.scope.workId).filter(row => row.assetKey === 'bg.harbor-night' && row.version === 1).first()
    await expect(deleteAvgMediaAsset({ scope: owned.scope, mediaAssetId: old!.id! })).rejects.toThrow('发布引用')
    await updateAvgPresentation({ scope: owned.scope, gameDefinitionId: definition.id!, content: (await db.avgPresentationModules.where('gameDefinitionId').equals(definition.id!).first())!.contentJson })
    const second = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! }); expect(second.gameRelease.contentHash).not.toBe(originalHash); expect(parseAvgGameReleaseManifest(second.gameRelease.manifestJson).presentation.assets.find(asset => asset.assetKey === 'bg.harbor-night')?.version).toBe(2)
  }, 30_000)

  it('媒资缺失只追加可回放诊断，不改变 Narrative 或舞台', async () => {
    const owned = await workspace('AVG 缺失降级'); const definition = await seedAvgAcceptanceGame({ scope: owned.scope }); const published = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! }); const session = await createAvgGameInstance({ scope: owned.scope, gameReleaseId: published.gameRelease.id!, title: '缺失媒资' })
    const before = await readSimulationState(session.id!); const event = await recordAvgMediaFailure({ sessionId: session.id!, assetKey: 'bg.harbor-night', reason: '模拟缓存缺失', commandId: 'media.failure.harbor' })
    expect(await recordAvgMediaFailure({ sessionId: session.id!, assetKey: 'bg.harbor-night', reason: '模拟缓存缺失', commandId: 'media.failure.harbor' })).toEqual(event)
    await expect(recordAvgMediaFailure({ sessionId: session.id!, assetKey: 'audio.theme', reason: '不同命令', commandId: 'media.failure.harbor' })).rejects.toThrow('不同媒资诊断')
    const after = await readSimulationState(session.id!); expect(after.narrative).toEqual(before.narrative); expect(after.presentation?.stage).toEqual(before.presentation?.stage); expect(after.presentation?.mediaFailures).toEqual([{ assetKey: 'bg.harbor-night', reason: '模拟缓存缺失', eventSequence: event.sequence }])
    const events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence'); expect(replaySimulationEvents(JSON.parse(session.initialStateJson), events)).toEqual(after)
  }, 30_000)

  it('发布前拒绝元数据与本地二进制不一致，且不创建世界修订', async () => {
    const owned = await workspace('AVG 发布完整性'); const definition = await seedAvgAcceptanceGame({ scope: owned.scope }); const asset = await db.avgMediaAssets.where('[workId+assetKey+version]').equals([owned.scope.workId, 'bg.harbor-night', 1]).first(); const blob = await db.avgMediaBlobs.where('mediaAssetId').equals(asset!.id!).first(); const damaged = blob!.data.slice(0); new Uint8Array(damaged)[0] ^= 0xff; await db.avgMediaBlobs.update(blob!.id!, { data: damaged })
    await expect(publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! })).rejects.toThrow('二进制缺失或完整性失败'); expect(await db.worldRevisions.where('worldId').equals(owned.scope.worldId).count()).toBe(0); expect(await db.gameReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
  }, 30_000)
})
