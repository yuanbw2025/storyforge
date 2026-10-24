import {canonicalStringify} from '../agent/run/hash'
import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'
import {parseChatNarrativeStateV1} from './narrative-contract'

function fail(message: string): never {throw new Error(`[chat-reflection] ${message}`)}

/** Private, tentative intentions/hypotheses change in the same reviewed action
 * as its expression. The event carries provenance; no second truth store or
 * automatic execution of a future plan is created. */
export function applyChatActorReflectionV1(state: CharacterInteractionRuntimeState, input: {
  sequence: number; actorKey: string; action: ChatNarrativeActionV1
}): void {
  const {action, actorKey, sequence} = input
  if (action.nextPossibilities === undefined && action.beliefUpdates === undefined && !action.goalUpdates?.length) return
  const story = state.chatNarrative!
  const situation = story.situation
  const evidence = (ids: string[]) => {
    if (!ids.length || ids.some(id => !situation.facts.some(f => f.factKey === id && f.audienceKeys.includes(actorKey)))) fail('打算或猜测缺少角色已知事实依据')
  }
  const changed = new Set<string>()
  for (const update of action.beliefUpdates ?? []) {
    if (changed.has(update.beliefKey)) fail('同一猜测不能在本次行动中重复修改')
    changed.add(update.beliefKey); evidence(update.evidenceFactKeys)
    const existing = situation.beliefs.find(b => b.beliefKey === update.beliefKey)
    if (existing && existing.actorKey !== actorKey) fail('不能修改其他角色的猜测')
    if (update.text === null) {
      if (!existing) fail('不能撤回不存在的猜测')
      situation.beliefs = situation.beliefs.filter(b => b.beliefKey !== update.beliefKey)
    } else {
      if (existing?.text === update.text && canonicalStringify(existing.evidenceFactKeys) === canonicalStringify(update.evidenceFactKeys)) fail('猜测没有发生变化')
      const next = {beliefKey: update.beliefKey, actorKey, text: update.text, evidenceFactKeys: [...update.evidenceFactKeys], updatedSequence: sequence}
      if (existing) situation.beliefs = situation.beliefs.map(b => b.beliefKey === update.beliefKey ? next : b)
      else situation.beliefs.push(next)
    }
  }
  if (action.nextPossibilities != null) {
    const texts = new Set<string>()
    for (const plan of action.nextPossibilities) {
      evidence(plan.evidenceFactKeys)
      if (texts.has(plan.text)) fail('后续打算重复')
      texts.add(plan.text)
    }
    // Replace this actor's complete plan set; other roles retain their own
    // private choices. Empty means a meaningful pause/closure, not an error.
    situation.possibilities = [...situation.possibilities.filter(p => p.actorKey !== actorKey),
      ...action.nextPossibilities.map(p => ({actorKey, text: p.text, evidenceFactKeys: [...p.evidenceFactKeys]}))]
  }
  if ((action.nextPossibilities !== undefined || action.goalUpdates?.length) && !situation.goals.some(g => g.actorKey === actorKey && ['active', 'paused'].includes(g.status))
    && situation.possibilities.some(p => p.actorKey === actorKey)) fail('角色目标已全部收束，须明确清空旧打算；新方向应先建立新情境')
  state.chatNarrative = parseChatNarrativeStateV1(story, {
    participantKeys: state.profiles.map(p => p.participantKey), characterKeys: state.profiles.map(p => p.characterKey), sceneKeys: state.sceneTemplates.map(s => s.sceneKey),
  })
}
