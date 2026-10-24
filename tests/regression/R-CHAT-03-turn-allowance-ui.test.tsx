import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement, type ComponentProps} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import * as skills from '../../src/lib/agent/skill-registry'
import NarrativeControls from '../../src/components/character-interaction/NarrativeControls'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

const originalSkill = skills.getAgentSkillV1
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = originalSkill(id)
    return id === 'character.chat-narrative-action' ? {...skill, promptVersion: 'chat-narrative-action-v45'} : skill
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
function props(budget: number): ComponentProps<typeof NarrativeControls> {
  const interaction = createInitialInteractionState(chatNarrativeFixture())
  interaction.activeScene = {...interaction.sceneTemplates[0], sceneId: 'scene-1', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  interaction.remainingDirectorBudget = budget
  return {interaction, runtimeSequence: 1, participantKey: 'guard', actionLimit: 1, schedulingMode: 'manual', disabled: false, turnResume: null,
    onParticipantChange: vi.fn(), onActionLimitChange: vi.fn(), onSchedulingModeChange: vi.fn(), onAdvance: vi.fn(), onResume: vi.fn(), onCompare: vi.fn(), onCreateSituation: vi.fn()}
}
const render = async (value: ComponentProps<typeof NarrativeControls>) => act(async () => root.render(createElement(NarrativeControls, value)))
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!
function pending(value: ComponentProps<typeof NarrativeControls>, seed = false) {
  value.interaction = requestChatNarrativeTriggerV1(value.interaction, {sequence: 2, kind: seed ? 'player-seed' : 'scene-start', sourceEventSequence: 1,
    seed: seed ? '门外传来敲门声。' : null, direction: {actorKey: 'guard', actionLimit: 1}})
  value.runtimeSequence = 2
  value.turnResume = {triggerSequence: 2, actorKey: 'guard', remainingActions: 1, blockedReason: null}
}

it('disables a three-call action at two units while keeping two-option comparison available, without calling on mount', async () => {
  const value = props(2)
  value.actionProvider = 'codex'
  await render(value)
  expect(host.textContent).toContain('单次生成的 token 用量无法提前锁定')
  expect(button('让角色开场').disabled).toBe(true)
  expect(button('比较两种行动').disabled).toBe(false)
  expect(host.textContent).toContain('开始这一步至少需要 3 次')
  await act(async () => button('让角色开场').click())
  expect(value.onAdvance).not.toHaveBeenCalled()
  value.interaction.remainingDirectorBudget = 3
  await render(value)
  expect(button('让角色开场').disabled).toBe(false)
  await act(async () => button('让角色开场').click())
  expect(value.onAdvance).toHaveBeenCalledTimes(1)
  expect(value.onAdvance).toHaveBeenCalledWith('scene-start')
  expect(host.textContent).not.toContain('掌柜把铜印')
})

it('prices a new continue from the next trigger even while the previous one waits for the player', async () => {
  const value = props(2); pending(value)
  value.turnResume = null
  value.interaction.chatNarrative!.triggers[0].status = 'waiting-player'
  await render(value)
  expect(button('让角色继续').disabled).toBe(true)
  expect(button('比较两种行动').disabled).toBe(false)
  expect(host.textContent).toContain('角色正在等你的回应')
})

it('requires five for an unbuilt seed and only three after that same background has been prepared', async () => {
  const value = props(4); pending(value, true)
  await render(value)
  expect(button('补齐未完成本轮').disabled).toBe(true)
  expect(host.textContent).toContain('开始这一步至少需要 5 次')
  value.interaction.remainingDirectorBudget = 5
  await render(value)
  expect(button('补齐未完成本轮').disabled).toBe(false)
  value.interaction.chatNarrative!.situation.seed = {text: '门外传来敲门声。', origin: 'player-request', sourceEventSequence: 2, sourceThreadKey: null}
  value.interaction.remainingDirectorBudget = 3
  await render(value)
  expect(button('补齐未完成本轮').disabled).toBe(false)
  value.interaction.remainingDirectorBudget = 2
  await render(value)
  expect(button('补齐未完成本轮').disabled).toBe(true)
})

it('keeps a final background-only settlement at two calls and respects its model availability', async () => {
  const value = props(2); pending(value)
  const story = value.interaction.chatNarrative!, trigger = story.triggers[0]
  story.permissions.allowActorSituationExpansion = true
  trigger.direction!.settleSituationVersion = 1
  trigger.actionSequences = [3]
  story.pendingSituation = {actorKey: 'guard', goalKey: 'find-seal', sourceEventSequence: 3, threadKey: 'investigate', direction: '检查后门', evidenceFactKeys: ['lost'], evidenceExcerpt: '检查后门'}
  value.runtimeSequence = 3
  value.turnResume = {...value.turnResume!, remainingActions: 0, pendingSituation: true}
  await render(value)
  expect(button('补齐本轮情境').disabled).toBe(false)
  await render({...value, situationDisabled: true})
  expect(button('补齐本轮情境').disabled).toBe(true)
  value.interaction.remainingDirectorBudget = 1
  await render(value)
  expect(button('补齐本轮情境').disabled).toBe(true)
})

it('uses the automatically selected audience and keeps legacy version controls at two calls', async () => {
  const value = props(2)
  value.schedulingMode = 'round-robin'; value.participantKey = ''; value.audienceKeys = ['artisan']
  await render(value)
  expect(button('让角色开场').disabled).toBe(true)
  value.interaction.remainingDirectorBudget = 3
  await render(value)
  expect(button('让角色开场').disabled).toBe(false)
  value.interaction.remainingDirectorBudget = 2
  vi.mocked(skills.getAgentSkillV1).mockImplementation(id => id === 'character.chat-narrative-action'
    ? {...originalSkill(id), promptVersion: 'chat-narrative-action-v44'} : originalSkill(id))
  await render(value)
  expect(button('让角色开场').disabled).toBe(false)
})

it('reserves five for direction continuation and four for comparison after a shared background', async () => {
  const value = props(4); pending(value)
  const story = value.interaction.chatNarrative!, trigger = story.triggers[0]
  story.permissions.allowActorSituationExpansion = true
  trigger.kind = 'continue'; trigger.requestedSequence = 4; trigger.sourceEventSequence = 3
  story.triggers.unshift({...trigger, kind: 'scene-start', requestedSequence: 2, sourceEventSequence: 1, status: 'complete', actionSequences: [3]})
  story.pendingSituation = {actorKey: 'guard', goalKey: 'find-seal', sourceEventSequence: 3, threadKey: 'investigate', direction: '检查后门', evidenceFactKeys: ['lost'], evidenceExcerpt: '检查后门'}
  value.runtimeSequence = 4
  value.turnResume = {...value.turnResume!, triggerSequence: 4}
  await render(value)
  expect(button('让角色继续').disabled).toBe(true)
  expect(button('发展局面并比较行动').disabled).toBe(false)
  expect(button('补齐未完成本轮').disabled).toBe(true)
  value.interaction.remainingDirectorBudget = 5
  await render({...value, situationDisabled: true})
  expect(button('补齐未完成本轮').disabled).toBe(true)
  await render(value)
  expect(button('补齐未完成本轮').disabled).toBe(false)
})
