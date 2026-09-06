import type { AssembleContextInput } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { createDeterministicGmSynthesisFrameV2 } from './action-feedback'
import { loadTtrpgGmRuntimeViewV1, type TtrpgGmRuntimeViewV1 } from './gm-context'

/** Public prose has no access to the director's truth, private clues or character profiles. */
export function projectTtrpgPublicNarrationViewV1(view: TtrpgGmRuntimeViewV1) {
  const action = view.latestAction
  if (!view.scene || !action?.receipt) throw new Error('[ttrpg-narrator-context] 缺少已结算行动')
  return {
    schema: 'storyforge.ttrpg-public-narration-view' as const,
    version: 1 as const,
    session: structuredClone(view.session),
    safety: { status: view.safety.status, lines: [...view.safety.lines], veils: [...view.safety.veils] },
    scene: { sceneKey: view.scene.sceneKey, title: view.scene.title, description: view.scene.description },
    actors: view.participants.map(actor => ({ actorKey: actor.entityKey, name: actor.name, kind: actor.kind })),
    latestAction: {
      eventSequence: action.eventSequence, actorKey: action.actorKey, targetKey: action.targetKey,
      actionKey: action.actionKey, actionName: action.actionName, outcome: action.outcome,
      declaredIntent: action.actorAuthority?.source === 'ai-gm-npc' ? null : action.receipt.context.declaredIntent,
      // NPC private deliberation never enters the public renderer.
      spokenIntent: null,
    },
    synthesisTemplate: createDeterministicGmSynthesisFrameV2(action.receipt),
    discoveredClues: view.discoveredClues.filter(clue => clue.visibility === 'party').map(clue => ({
      clueKey: clue.clueKey, title: clue.title, description: clue.description,
    })),
    // Keys are proposals only. Undiscovered titles/descriptions are deliberately absent.
    suggestibleClues: view.suggestibleClues.map(clue => ({ clueKey: clue.clueKey, discoveryActions: clue.discoveryActions })),
    nextScenes: view.nextScenes.map(scene => ({ sceneKey: scene.sceneKey, title: scene.title })),
    previousNarrations: view.recentNarrations.map(item => ({ text: item.text })),
  }
}

export async function readTtrpgPublicNarrationContextV1(input: AssembleContextInput): Promise<string> {
  if (input.productRuntimeSessionId == null) return ''
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const view = await loadTtrpgGmRuntimeViewV1({ scope, productRuntimeSessionId: input.productRuntimeSessionId })
  if (input.worldGroupId !== undefined && view.session.worldGroupId !== (input.worldGroupId ?? null)) return ''
  return JSON.stringify(projectTtrpgPublicNarrationViewV1(view))
}
