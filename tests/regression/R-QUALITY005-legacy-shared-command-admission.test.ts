import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { commitAdventureAction } from '../../src/lib/adventure/runtime-commands'
import { commitInteractionPlayerMessage, startInteractionScene } from '../../src/lib/character-interaction/runtime-commands'
import { readProductRuntimeState, readProductRuntimeStateVersion, verifyFormalRuntimeSourceV1 } from '../../src/lib/product/runtime-core'
import { generateAdventureRuntimeCandidateV1 } from '../../src/lib/adventure/harness'
import { generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1 } from '../../src/lib/character-interaction/harness'
import { seedQuality005LegacyHybridV1 } from '../helpers/quality005-legacy-hybrid'
import { snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import { seedQuality005LegacyInteractionCandidateV1 } from '../helpers/quality005-legacy-interaction-candidate'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'
import { availableAdventureActions } from '../../src/lib/adventure/runtime'

const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

// Narrow original captured command fields without rewriting the captured
// object, adding a receipt, or manufacturing a current authorization.
function originalAdventureCommand(value: Record<string, unknown>): Parameters<typeof commitAdventureAction>[0] {
  const { sessionId, commandId, baseSequence, baseStateHash, actionKey } = value
  if (typeof sessionId !== 'number' || typeof commandId !== 'string' || typeof baseSequence !== 'number'
    || typeof baseStateHash !== 'string' || typeof actionKey !== 'string') throw new Error('Invalid original Adventure command capture')
  return { ...value, sessionId, commandId, baseSequence, baseStateHash, actionKey }
}

function originalSceneCommand(value: Record<string, unknown>): Parameters<typeof startInteractionScene>[0] {
  const { sessionId, commandId, baseSequence, baseStateHash, sceneKey, sceneId } = value
  if (typeof sessionId !== 'number' || typeof commandId !== 'string' || typeof baseSequence !== 'number'
    || typeof baseStateHash !== 'string' || typeof sceneKey !== 'string' || typeof sceneId !== 'string') throw new Error('Invalid original Interaction command capture')
  return { ...value, sessionId, commandId, baseSequence, baseStateHash, sceneKey, sceneId }
}

describe('SFQA-005 · historical hybrid modules do not grant new cross-product command writes', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('rejects an otherwise valid native Adventure action on a source-verified legacy novel hybrid', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'adventure')!
    const session = (await db.productRuntimeSessions.get(old.emptySessionId))!
    const source = await verifyFormalRuntimeSourceV1(session, ['text-open-world'])
    expect(source.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('novel-source-pin')
    expect(source.runtimePackage.adventure).toBeTruthy()
    const base = await readProductRuntimeStateVersion(session.id!), before = await snapshotQuality005RowsV1()
    await expect(commitAdventureAction({ sessionId: session.id!, actionKey: String(old.command.actionKey),
      commandId: '005.new-shared-adventure', baseSequence: base.sequence, baseStateHash: base.stateHash }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects an otherwise valid new Interaction scene on the same verified historical source', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'interaction')!
    const base = await readProductRuntimeStateVersion(old.emptySessionId), before = await snapshotQuality005RowsV1()
    await expect(startInteractionScene({ sessionId: old.emptySessionId, sceneKey: String(old.command.sceneKey),
      sceneId: '005.new-shared-scene', commandId: '005.new-shared-interaction', baseSequence: base.sequence, baseStateHash: base.stateHash }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a new player message while the original historical scene remains readable', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'interaction')!
    const sessionId = Number(old.command.sessionId), base = await readProductRuntimeStateVersion(sessionId)
    const before = await snapshotQuality005RowsV1()
    await expect(commitInteractionPlayerMessage({ sessionId, messageId: '005.new-message', text: 'New interaction must use a sealed world source.',
      commandId: '005.new-shared-message', baseSequence: base.sequence, baseStateHash: base.stateHash })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('returns exact original Adventure/Interaction receipts without writes and rejects command mismatches', async () => {
    const f = await seedQuality005LegacyHybridV1()
    const adventure = f.cases.find(row => row.mode === 'adventure')!, interaction = f.cases.find(row => row.mode === 'interaction')!
    const before = await snapshotQuality005RowsV1()
    const action = originalAdventureCommand(adventure.command)
    const scene = originalSceneCommand(interaction.command)
    expect(await commitAdventureAction(action)).toEqual(adventure.event)
    expect(await startInteractionScene(scene)).toEqual(interaction.event)
    await expect(commitAdventureAction({ ...action, actionKey: 'different-action' })).rejects.toThrow(/不同命令/)
    await expect(startInteractionScene({ ...scene, sceneId: 'different-scene' })).rejects.toThrow(/不同命令/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it.each(['adventure', 'interaction'] as const)('reads only the exact old %s receipt when its Release is missing', async mode => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === mode)!
    await db.productReleases.delete(f.releaseId)
    const before = await snapshotQuality005RowsV1()
    if (mode === 'adventure') {
      const input = originalAdventureCommand(old.command)
      expect(await commitAdventureAction(input)).toEqual(old.event)
      await expect(commitAdventureAction({ ...input, actionKey: 'different-action' })).rejects.toThrow(/不同命令/)
      await expect(commitAdventureAction({ ...input, commandId: '005.new-after-release-disappeared' })).rejects.toThrow()
    } else {
      const input = originalSceneCommand(old.command)
      expect(await startInteractionScene(input)).toEqual(old.event)
      await expect(startInteractionScene({ ...input, sceneId: 'different-scene' })).rejects.toThrow(/不同命令/)
      await expect(startInteractionScene({ ...input, commandId: '005.new-after-release-disappeared' })).rejects.toThrow()
    }
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('blocks the shared Adventure model generator before a synthetic transport or new Run can run', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'adventure')!
    const runAI = vi.fn(async () => JSON.stringify({ kind: 'adventure-intent', actionKey: old.command.actionKey,
      rationale: 'A real frozen action in the old module.', requiresConfirmation: true }))
    const before = await snapshotQuality005RowsV1()
    const failure = await generateAdventureRuntimeCandidateV1({ scope: f.scope, productRuntimeSessionId: old.emptySessionId,
      skillId: 'prose.adventure-intent-parser', objective: 'Select the frozen historical action.', runAI }).then(() => null, error => error)
    expect(runAI).not.toHaveBeenCalled()
    expect(failure?.message).toMatch(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('blocks the shared Interaction model generator on the real active historical scene', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'interaction')!
    const sessionId = Number(old.command.sessionId), state = await readProductRuntimeState(sessionId)
    const participantKey = state.interaction!.profiles.find(profile => profile.participantKey !== 'player')!.participantKey
    const runAI = vi.fn(async () => JSON.stringify({ kind: 'scene-director', responders: [], shouldEnd: false, endReason: null }))
    const before = await snapshotQuality005RowsV1()
    const failure = await generateInteractionRuntimeCandidateV1({ scope: f.scope, productRuntimeSessionId: sessionId,
      participantKey, skillId: 'prose.interaction-scene-director', objective: 'Review the frozen active scene.', runAI }).then(() => null, error => error)
    expect(runAI).not.toHaveBeenCalled()
    expect(failure?.message).toMatch(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a real retained legacy candidate before creating a new accepted receipt', async () => {
    const f = await seedQuality005LegacyInteractionCandidateV1()
    const before = await snapshotQuality005RowsV1()
    await expect(adoptInteractionRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('reads an actual old completed candidate receipt without new model, adoption or event writes', async () => {
    const f = await seedQuality005LegacyInteractionCandidateV1(true)
    const before = await snapshotQuality005RowsV1()
    expect((await adoptInteractionRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).receiptHash).toBe(f.receiptHash)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(adoptInteractionRuntimeCandidateV1({ scope: { ...f.scope, workId: f.scope.workId + 999 }, runId: f.runId })).rejects.toThrow()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('preserves native Adventure, Interaction and candidate adoption for a strict World-referenced hybrid', async () => {
    const f = await createGovernedTextOpenWorldSessionFixtureV1({ name: '005 World hybrid normal control',
      textOpenWorldVNext: createTextOpenWorldVNextFixture(), runtimeShape: 'hybrid-compatibility', seed: '005-world-hybrid' })
    const source = await verifyFormalRuntimeSourceV1(f.session, ['text-open-world'])
    expect(source.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('world-release')
    const state = await readProductRuntimeState(f.session.id!)
    const action = availableAdventureActions(f.runtimePackage.adventure!, state.adventure!).find(item => item.available && item.action.kind !== 'move')!.action
    let base = await readProductRuntimeStateVersion(f.session.id!)
    await commitAdventureAction({ sessionId: f.session.id!, actionKey: action.key, commandId: '005.world-adventure',
      baseSequence: base.sequence, baseStateHash: base.stateHash })
    base = await readProductRuntimeStateVersion(f.session.id!)
    await startInteractionScene({ sessionId: f.session.id!, sceneKey: f.runtimePackage.interaction!.sceneTemplates[0].sceneKey,
      sceneId: '005.world-scene', commandId: '005.world-interaction', baseSequence: base.sequence, baseStateHash: base.stateHash })
    const runtime = await readProductRuntimeState(f.session.id!)
    const participantKey = runtime.interaction!.profiles.find(profile => profile.participantKey !== 'player')!.participantKey
    const runAI = vi.fn(async () => JSON.stringify({ kind: 'scene-director', responders: [], shouldEnd: false, endReason: null }))
    const generated = await generateInteractionRuntimeCandidateV1({ scope: f.scope, productRuntimeSessionId: f.session.id!,
      participantKey, skillId: 'prose.interaction-scene-director', objective: 'Normal frozen World scene.', runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect((await adoptInteractionRuntimeCandidateV1({ scope: f.scope, runId: generated.snapshot.run.id })).snapshot.projection.state).toBe('completed')
  }, 30_000)
})
