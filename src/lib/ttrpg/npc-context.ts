import type { AssembleContextInput } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgGmRuntimeViewV1, type TtrpgGmRuntimeViewV1 } from './gm-context'

/** The allow-list is deliberate: GM memory, clues, secrets and other profiles never enter an NPC prompt. */
export function projectTtrpgNpcDecisionViewV1(view: TtrpgGmRuntimeViewV1) {
  const turn = view.activeTurn
  if (!turn || !view.scene) throw new Error('[ttrpg-npc-context] 没有活动 NPC 场景')
  const actor = view.participants.find(item => item.entityKey === turn.actorKey)
  if (!actor || actor.privateProfile?.kind !== 'npc') throw new Error('[ttrpg-npc-context] NPC 身份缺少已发布角色资料')
  return {
    schema: 'storyforge.ttrpg-npc-decision-view' as const,
    version: 1 as const,
    session: structuredClone(view.session),
    safety: { status: view.safety.status, lines: [...view.safety.lines], veils: [...view.safety.veils] },
    scene: {
      sceneKey: view.scene.sceneKey, title: view.scene.title, description: view.scene.description,
      locationKey: view.scene.locationKey,
    },
    activeTurn: structuredClone(turn),
    self: { name: actor.name, attributes: structuredClone(actor.attributes), conditions: structuredClone(actor.conditions), profile: structuredClone(actor.privateProfile) },
    // Other actors' statistics, motives and secrets are not observations.
    actors: view.participants.map(item => ({ actorKey: item.entityKey, name: item.name, kind: item.kind })),
  }
}

export async function readTtrpgNpcRuntimeContextV1(input: AssembleContextInput): Promise<string> {
  if (input.productRuntimeSessionId == null) return ''
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const view = await loadTtrpgGmRuntimeViewV1({ scope, productRuntimeSessionId: input.productRuntimeSessionId })
  if (input.worldGroupId !== undefined && view.session.worldGroupId !== (input.worldGroupId ?? null)) return ''
  return JSON.stringify(projectTtrpgNpcDecisionViewV1(view))
}
