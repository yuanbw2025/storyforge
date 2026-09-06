import { generateTtrpgGmActorActionCandidateV1, adoptTtrpgGmActorActionCandidateV1 } from '../../src/lib/ttrpg/gm-actor-harness'
import { loadTtrpgGmRuntimeViewV1 } from '../../src/lib/ttrpg/gm-context'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from './current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from './current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from './current-product-build'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgSessionZero, openTtrpgCampaignScene, readProductRuntimeState, readProductRuntimeStateVersion, resolveTtrpgRuleAction } from '../../src/lib/ttrpg/runtime-api'
import type { WorldRelease } from '../../src/lib/types'

export async function readyAiKpSession(title: string) {
  const world = await seedCurrentProductWorld(title)
  const release = world.release as WorldRelease & { id: number }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'ttrpg' })
  const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({ scope: world.scope, worldRelease: release, sourceCatalog,
    playerController: 'human', gmMode: 'ai' })
  const { session } = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title })
  for (const seat of await readTtrpgSessionParticipantsV2(session.id!)) await configureTtrpgSessionParticipantV2({
    sessionId: session.id!, seatKey: seat.seatKey, expectedRevision: seat.revision, commandId: `consent.${seat.seatKey}`,
    requestedByViewerKey: 'viewer.gm', consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true },
  })
  let state = await readProductRuntimeState(session.id!)
  let version = await readProductRuntimeStateVersion(session.id!)
  await completeTtrpgSessionZero({ sessionId: session.id!, commandId: 'zero', baseSequence: version.sequence, baseStateHash: version.stateHash,
    acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys, completedBy: 'gm' })
  version = await readProductRuntimeStateVersion(session.id!)
  await openTtrpgCampaignScene({ sessionId: session.id!, commandId: 'opening', baseSequence: version.sequence,
    baseStateHash: version.stateHash, sceneKey: runtimePackage.ttrpg!.campaign.openingSceneKey })
  // Reach and resolve a player investigation, using the actual initiative and RulePack.
  for (let index = 0; index < 8; index++) {
    state = await readProductRuntimeState(session.id!)
    const actorKey = state.ttrpg!.activeActorKey!
    const actor = runtimePackage.ttrpg!.campaign.characterTemplates.find(item => item.characterKey === actorKey)!
    const scene = runtimePackage.ttrpg!.campaign.scenes.find(item => item.sceneKey === state.ttrpg!.scene!.sceneKey)!
    if (actor.role === 'npc') {
      const view = await loadTtrpgGmRuntimeViewV1({ scope: world.scope, productRuntimeSessionId: session.id! })
      const turn = view.activeTurn!, action = turn.availableActions[0]
      const targetKey = action.target === 'scene' ? null : action.target === 'self' ? actorKey
        : turn.visibleTargets.find(target => target.actorKey !== actorKey && target.role === (action.target === 'single-ally' ? 'npc' : 'player'))!.actorKey
      const generated = await generateTtrpgGmActorActionCandidateV1({ scope: world.scope, productRuntimeSessionId: session.id!, objective: '检查现场',
        runAI: async () => JSON.stringify({ actionKey: action.actionKey, targetKey, approach: '检查眼前痕迹。', spokenIntent: null }) })
      await adoptTtrpgGmActorActionCandidateV1({ scope: world.scope, runId: generated.candidate.runId })
      continue
    }
    const actionKey = actor.role === 'player'
      ? runtimePackage.ttrpg!.campaign.clues.flatMap(clue => clue.discoveryPaths).find(path => path.sceneKey === scene.sceneKey)!.actionKey
      : actor.actionKeys.find(key => scene.actionKeys.includes(key))!
    const action = runtimePackage.ttrpg!.rulePack.content.actions.find(item => item.key === actionKey)!
    version = await readProductRuntimeStateVersion(session.id!)
    await resolveTtrpgRuleAction({ sessionId: session.id!, commandId: `action.${index}`, baseSequence: version.sequence, baseStateHash: version.stateHash,
      actorKey, actionKey, targetKey: action.target === 'single' ? state.ttrpg!.turnOrder.find(key => key !== actorKey)! : null,
      difficulty: 8, declaredIntent: { intentKey: `intent.${index}`, rawInput: '查看现场痕迹，寻找求救信号的来源。', goal: '追踪求救信号', method: '仔细调查' } })
    if (actor.role === 'player') break
  }
  return { scope: world.scope, sessionId: session.id!, runtimePackage }
}
