import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { runTtrpgKpCycleV1 } from '../../src/lib/ttrpg/kp-coordinator'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { ttrpgCampaignNavigationV1 } from '../../src/lib/ttrpg/campaign-navigation'
import { completeTtrpgSessionZero, readProductRuntimeStateVersion, readProductRuntimeState, submitTtrpgActionIntentV2,
  recordTtrpgHumanResponseV2, openTtrpgCampaignScene, completeTtrpgCampaignEnding, createProductRuntimeCheckpoint,
  verifyProductRuntimeCheckpoint, branchProductRuntimeSession, replayProductRuntimeEvents } from '../../src/lib/ttrpg/runtime-api'
import type { ChatMessage, TtrpgProductionSeatV2, WorldRelease } from '../../src/lib/types'

describe('R-TTRPG4F · full mixed-party game rehearsal', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('真人、两个 AI 队友和 NPC 依次行动，证据解锁、跨场景结局、分支存档与重放保持一致', async () => {
    const world = await seedCurrentProductWorld('整场混合队伍排练')
    const release = world.release as WorldRelease & { id: number }
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'ttrpg' })
    const seats: TtrpgProductionSeatV2[] = ['林舟', '顾遥', '乔屿'].map((name, index) => ({ seatKey: `player.${index + 1}`, label: name,
      controller: index === 0 ? 'human' : 'ai', role: 'player', characterMode: 'quick-card', sourceCharacterResourceKey: null,
      characterName: name, rankTier: 'B', privateGoal: `保护 ${name} 自己的记忆` }))
    const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({ scope: world.scope, worldRelease: release,
      sourceCatalog, playerController: 'human', gmMode: 'ai', seats, authoredScenario: true })
    const campaign = runtimePackage.ttrpg!.campaign, rulePack = runtimePackage.ttrpg!.rulePack.content
    const { session } = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title: '混合队伍排练' })
    const sessionId = session.id!
    for (const seat of await readTtrpgSessionParticipantsV2(sessionId)) await configureTtrpgSessionParticipantV2({ sessionId,
      seatKey: seat.seatKey, expectedRevision: seat.revision, commandId: `configure.${seat.seatKey}`, requestedByViewerKey: 'viewer.gm',
      activation: seat.controller === 'ai' && seat.role === 'player' ? 'initiative' : 'manual',
      consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
    const envelope = async (label: string) => { const version = await readProductRuntimeStateVersion(sessionId)
      return { sessionId, commandId: `${label}.${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash } }
    await completeTtrpgSessionZero({ ...await envelope('zero'), acceptedItemKeys: (await readProductRuntimeState(sessionId)).ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: campaign.characterTemplates.filter(actor => actor.role === 'player').map(actor => actor.characterKey), completedBy: 'test-owner' })
    const modelKinds = new Set<string>()
    const runAI = async (messages: ChatMessage[]) => {
      const prompt = messages.map(message => message.content).join('\n')
      const user = messages.find(message => message.role === 'user')!.content
      if (prompt.includes('storyforge.ttrpg-director-view')) {
        modelKinds.add('director')
        const view = JSON.parse(user.slice(user.indexOf('{"schema":"storyforge.ttrpg-director-view"')))
        return JSON.stringify({ revealClueKeys: view.options.eligibleReveals.slice(0, 1).map((item: { clueKey: string }) => item.clueKey),
          recommendedSceneKeys: [], recommendedEndingKeys: [], pacing: 'investigate' })
      }
      if (prompt.includes('storyforge.ttrpg-public-narration-view')) {
        modelKinds.add('narrator')
        const view = JSON.parse(user.slice(user.indexOf('{"schema":"storyforge.ttrpg-public-narration-view"')))
        expect(prompt).not.toContain('值班记录在十年前被改过一次')
        return JSON.stringify({ narration: '海雾间传来一阵脚步声，眼前的动静正等待你们回应。', synthesisFrame: view.synthesisTemplate,
          offeredClueKeys: [], recommendedNextSceneKeys: [] })
      }
      const npc = prompt.includes('storyforge.ttrpg-npc-decision-view')
      modelKinds.add(npc ? 'npc' : 'ai-player')
      const marker = npc ? '{"schema":"storyforge.ttrpg-npc-decision-view"' : '{"schema":"storyforge.ttrpg-player-runtime-view"'
      const view = JSON.parse(user.slice(user.indexOf(marker)))
      expect(prompt).not.toContain('值班记录在十年前被改过一次')
      const actorKey = npc ? view.activeTurn.actorKey : view.seat.actorKey
      for (const actor of campaign.characterTemplates.filter(actor => actor.characterKey !== actorKey)) {
        expect(prompt).not.toContain(actor.playerProfile?.secret ?? actor.gmProfile!.secret)
      }
      const actions = npc ? view.activeTurn.availableActions : view.projection.availableActions
      const action = actions.find((action: { actionKey: string; target: string }) => action.actionKey === 'investigate' && action.target === 'scene')
        ?? actions.find((action: { target: string }) => action.target === 'scene' || action.target === 'self')
      return JSON.stringify({ actionKey: action.actionKey, targetKey: action.target === 'self' ? actorKey : null,
        approach: '我沿着灯座仔细查看残留的油痕。', spokenIntent: null })
    }
    const human = (await readTtrpgSessionParticipantsV2(sessionId)).find(seat => seat.controller === 'human' && seat.role === 'player')!
    // Three full rounds exercise every seat and all three discoverable clues.
    for (let round = 0; round < 3; round++) {
      for (let step = 0; step < 8; step++) {
        const cycle = await runTtrpgKpCycleV1({ scope: world.scope, productRuntimeSessionId: sessionId, runAI, maxAiActions: 8 })
        const state = await readProductRuntimeState(sessionId)
        const projection = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'player', actorKey: human.actorKey,
          participantControllers: Object.fromEntries((await readTtrpgSessionParticipantsV2(sessionId)).filter(seat => seat.actorKey).map(seat => [seat.actorKey!, seat.controller])) })
        if (cycle.status === 'human-response') {
          const response = projection.pendingHumanResponses[0]
          expect(response).toBeDefined()
          await recordTtrpgHumanResponseV2({ ...await envelope('response'), ...response, kind: 'decline', text: '', audience: 'party', viewerKey: human.viewerKey })
          continue
        }
        expect(cycle.status).toBe('human-turn')
        const action = projection.availableActions.find(action => action.actionKey === 'investigate')!
        expect(action).toBeDefined()
        await submitTtrpgActionIntentV2({ ...await envelope('action'), intentKey: `intent.${round}`, actorKey: human.actorKey!,
          rawInput: '检查灯座并向同伴指出可疑痕迹。', actionKey: action.actionKey, targetKey: null,
          goal: '确认灯号来源', submittedBy: { role: 'player', viewerKey: human.viewerKey } })
        break
      }
    }
    await runTtrpgKpCycleV1({ scope: world.scope, productRuntimeSessionId: sessionId, runAI, maxAiActions: 8 })
    let state = await readProductRuntimeState(sessionId)
    expect(state.ttrpg!.product!.discoveredClues).toHaveLength(3)
    expect(new Set(state.ttrpg!.product!.actionHistory.map(action => action.actorKey)).size).toBe(4)
    expect(modelKinds).toEqual(new Set(['npc', 'ai-player', 'director', 'narrator']))
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId, name: '调查完成' })
    expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(true)
    for (let transition = 0; transition < 3; transition++) {
      const routes = ttrpgCampaignNavigationV1(state, campaign)
      if (routes.endings.length) {
        await completeTtrpgCampaignEnding({ ...await envelope('ending'), endingKey: routes.endings[0].endingKey, completedBy: human.actorKey! })
        break
      }
      expect(routes.nextScenes.length).toBeGreaterThan(0)
      await openTtrpgCampaignScene({ ...await envelope('move'), sceneKey: routes.nextScenes[0].sceneKey })
      state = await readProductRuntimeState(sessionId)
    }
    state = await readProductRuntimeState(sessionId)
    expect(state.ttrpg!.product!.ending).not.toBeNull()
    let unexpectedCalls = 0
    expect((await runTtrpgKpCycleV1({ scope: world.scope, productRuntimeSessionId: sessionId, runAI: async () => { unexpectedCalls++; return '' } })).status).toBe('ended')
    expect(unexpectedCalls).toBe(0)
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const stored = await db.productRuntimeSessions.get(sessionId)
    expect(replayProductRuntimeEvents(JSON.parse(stored!.initialStateJson), events)).toEqual(state)
    const child = await branchProductRuntimeSession({ parentSessionId: sessionId, throughSequence: checkpoint.throughSequence, title: '从调查完成继续' })
    const branched = await readProductRuntimeState(child.id!)
    expect(branched.ttrpg!.product!.ending).toBeNull()
    expect(branched.ttrpg!.product!.discoveredClues).toEqual(state.ttrpg!.product!.discoveredClues)
    expect(branched.ttrpg!.product!.directorDecisions).toEqual(state.ttrpg!.product!.directorDecisions)
    expect((await db.worldReleases.get(release.id))?.contentHash).toBe(release.contentHash)
  }, 60_000)
})
