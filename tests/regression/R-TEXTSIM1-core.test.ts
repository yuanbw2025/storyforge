import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createNarrativeSimulationAcceptanceContent,
  publishNarrativeSimulationGame,
  seedNarrativeSimulationAcceptanceGame,
  validateNarrativeSimulationGame,
} from '../../src/lib/narrative-simulation/authoring'
import {
  createInitialNarrativeSimulationState,
  parseNarrativeSimulationContent,
  planNarrativeSimulationTurn,
  runNarrativeSimulationBatch,
  validateNarrativeSimulationContent,
  validateNarrativeSimulationPresentationCandidate,
} from '../../src/lib/narrative-simulation/runtime'
import { db } from '../../src/lib/db/schema'
import {
  appendSimulationEvent,
  branchSimulationSession,
  commitNarrativeChoice,
  commitNarrativeSimulationTurn,
  readSimulationState,
  readSimulationStateVersion,
  replaySimulationEvents,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import { parseNarrativeSimulationGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createNarrativeSimulationInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'simulation', genres: ['simulation'], status: 'drafting', description: '',
    targetWordCount: 20_000, createdAt: now, updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

describe('TEXTSIM-1 · deterministic narrative simulation', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('验收内容覆盖 30 回合、六种资源指标、五个主体、十项行动、四项政策、三条问题链、两场危机、四结局与四题材', () => {
    const content = createNarrativeSimulationAcceptanceContent()
    expect(content).toMatchObject({ version: 1, turnLimit: 30, actionBudget: 2 })
    expect(content.resources.length + content.metrics.length).toBe(6)
    expect(content.actors).toHaveLength(5)
    expect(content.actions).toHaveLength(10)
    expect(content.actions.filter(action => action.category === 'policy')).toHaveLength(4)
    expect(content.issues).toHaveLength(3)
    expect(content.issues.filter(issue => issue.crisis)).toHaveLength(2)
    expect(content.endings).toHaveLength(4)
    expect(content.themes.map(theme => theme.key)).toEqual([
      'historic-town', 'cultivation-sect', 'space-colony', 'modern-company',
    ])
    expect(validateNarrativeSimulationContent({
      content,
      narrativeNodeKeys: content.endings.map(ending => ending.narrativeNodeKey),
    })).toMatchObject({ valid: true, missingReferences: [], unsolvedCrisisKeys: [], unreachableEndingKeys: [] })
    expect(() => parseNarrativeSimulationContent({ ...content, script: 'forbidden()' })).toThrow('字段不在白名单')
  })

  it('诊断断链、无解危机、不可达结局、支配行动与无限增长风险', () => {
    const content = createNarrativeSimulationAcceptanceContent()
    content.actions.push({ ...structuredClone(content.actions[0]), key: 'dominated', costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -30 }] })
    content.actions.push({ ...structuredClone(content.actions[0]), key: 'free-growth', costs: [], immediateEffects: [{ op: 'change-value', target: 'metric', key: 'stability', delta: 1 }], cooldownTurns: 0 })
    content.actions = content.actions.map(action => ({ ...action, immediateEffects: action.immediateEffects.filter(effect => effect.op !== 'change-issue-pressure' || effect.issueKey !== 'unrest'), delayedEffects: action.delayedEffects.map(delayed => ({ ...delayed, effects: delayed.effects.filter(effect => effect.op !== 'change-issue-pressure' || effect.issueKey !== 'unrest') })) }))
    content.endings[0].conditions = [{ source: 'turn', operator: 'gte', value: 31 }]
    const report = validateNarrativeSimulationContent({ content, narrativeNodeKeys: ['ending.missing'] })
    expect(report.valid).toBe(false)
    expect(report.missingReferences).toEqual(expect.arrayContaining(['narrative-node:ending.shared-prosperity']))
    expect(report.unsolvedCrisisKeys).toEqual(expect.arrayContaining(['unrest']))
    expect(report.unreachableEndingKeys).toEqual(expect.arrayContaining(['shared-prosperity']))
    expect(report.dominatedActionKeys).toEqual(expect.arrayContaining(['dominated']))
    expect(report.unboundedGrowthKeys).toEqual(expect.arrayContaining(['metric:stability']))
    content.actions[0].immediateEffects.push({ op: 'change-value', target: 'resource', key: 'districts', delta: 1 })
    expect(validateNarrativeSimulationContent({ content }).conservedMutationKeys).toEqual(['resource:districts'])
  })

  it('同发布与种子的 100/500 回合批量运行完全同构，并在 30 回合内确定结局', () => {
    const content = createNarrativeSimulationAcceptanceContent()
    const decide = () => [] as string[]
    const first = runNarrativeSimulationBatch({ content, contentHash: 'a'.repeat(64), seed: 'long-run', turns: 100, decide })
    const second = runNarrativeSimulationBatch({ content, contentHash: 'a'.repeat(64), seed: 'long-run', turns: 500, decide })
    expect(second).toEqual(first)
    expect(first.state.phase).toBe('ended')
    expect(first.state.turn).toBeLessThanOrEqual(30)
    expect(first.state.qualifiedEndingKey).not.toBeNull()
    expect(first.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'simulation.actor.action-resolved', 'simulation.issue.stage-changed',
      'simulation.report.created', 'simulation.ending.qualified', 'simulation.turn.ended',
    ]))
    const districts = first.events.filter(event => event.type === 'simulation.resource.changed'
      && event.targetKey === 'districts')
    expect(districts).toHaveLength(0)
    expect(first.state.resources.districts).toBe(12)
  })

  it('短期有利决策产生可追踪延迟副作用，批量结算在越界前原子拒绝', () => {
    const content = createNarrativeSimulationAcceptanceContent()
    let state = createInitialNarrativeSimulationState(content, 'b'.repeat(64))
    const first = planNarrativeSimulationTurn({ content, state, decisionKeys: ['ration-supplies'], seed: 'delay', startingSequence: 0 })
    state = first.projected
    expect(state.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ sourceActionKey: 'ration-supplies', dueTurn: 4, status: 'pending' })]))
    let sequence = first.descriptors.length
    for (let turn = 2; turn <= 4; turn += 1) {
      const plan = planNarrativeSimulationTurn({ content, state, decisionKeys: [], seed: 'delay', startingSequence: sequence })
      sequence += plan.descriptors.length
      state = plan.projected
    }
    expect(state.schedules.find(item => item.sourceActionKey === 'ration-supplies')?.status).toBe('settled')
    expect(state.decisionHistory[0]).toMatchObject({ actionKey: 'ration-supplies', turn: 1 })
    const broken = structuredClone(content)
    broken.metrics.find(metric => metric.key === 'stability')!.initial = 499
    expect(() => planNarrativeSimulationTurn({
      content: broken,
      state: createInitialNarrativeSimulationState(broken, 'c'.repeat(64)),
      decisionKeys: ['emergency-patrol'], seed: 'overflow', startingSequence: 0,
    })).toThrow('数值越界')
  })

  it.sequential('冻结发布、正式回合命令、幂等、回放、检查点、结局 Choice 与分支恢复形成完整闭环', async () => {
    const owned = await workspace('TEXTSIM 核心')
    const definition = await seedNarrativeSimulationAcceptanceGame({ scope: owned.scope })
    expect(await validateNarrativeSimulationGame(owned.scope, definition.id!)).toMatchObject({ valid: true })
    const publication = await publishNarrativeSimulationGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseNarrativeSimulationGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.simulation.turnLimit).toBe(30)
    expect(manifest.definition.enabledCapabilities).toEqual(['narrative', 'simulation'])
    const session = await createNarrativeSimulationInstance({
      scope: owned.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '治理存档',
      seed: 'published-seed',
    })
    const initial = await readSimulationState(session.id!)
    expect(initial.narrativeSimulation).toMatchObject({ turn: 1, phase: 'planning', contentHash: publication.gameRelease.contentHash })
    expect(initial.narrative?.variables.simulation).toMatchObject({ turn: 1, endingKey: null })
    await expect(appendSimulationEvent({
      sessionId: session.id!, type: 'simulation.turn.started', payload: { turn: 1, decisionKeys: [] },
    })).rejects.toThrow('专用回合命令')

    const base = await readSimulationStateVersion(session.id!)
    const first = await commitNarrativeSimulationTurn({
      sessionId: session.id!, decisionKeys: ['ration-supplies'], commandId: 'turn.1',
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
    const repeated = await commitNarrativeSimulationTurn({
      sessionId: session.id!, decisionKeys: ['ration-supplies'], commandId: 'turn.1',
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
    expect(repeated.events).toEqual(first.events)
    expect(repeated.state).toEqual(first.state)
    expect(await verifySimulationCheckpoint(first.checkpoint.id!)).toBe(true)
    const secondBase = await readSimulationStateVersion(session.id!)
    await commitNarrativeSimulationTurn({
      sessionId: session.id!, decisionKeys: [], commandId: 'turn.2',
      baseSequence: secondBase.sequence, baseStateHash: secondBase.stateHash,
    })
    const repeatedAfterAdvance = await commitNarrativeSimulationTurn({
      sessionId: session.id!, decisionKeys: ['ration-supplies'], commandId: 'turn.1',
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
    expect(repeatedAfterAdvance.state).toEqual(first.state)
    let state = await readSimulationState(session.id!)
    let events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(replaySimulationEvents(JSON.parse(session.initialStateJson), events)).toEqual(state)

    while (state.narrativeSimulation?.phase !== 'ended') {
      const version = await readSimulationStateVersion(session.id!)
      await commitNarrativeSimulationTurn({
        sessionId: session.id!, decisionKeys: [], commandId: `turn.${state.narrativeSimulation!.turn}`,
        baseSequence: version.sequence, baseStateHash: version.stateHash,
      })
      state = await readSimulationState(session.id!)
    }
    const endingKey = state.narrativeSimulation.qualifiedEndingKey!
    expect(state.narrative?.availableChoiceKeys).toEqual([`ending.${endingKey}`])
    const endingBase = await readSimulationStateVersion(session.id!)
    await commitNarrativeChoice({
      sessionId: session.id!, choiceKey: `ending.${endingKey}`, commandId: 'ending.commit',
      baseSequence: endingBase.sequence, baseStateHash: endingBase.stateHash,
    })
    expect((await readSimulationState(session.id!)).narrative).toMatchObject({ completed: true, endingKey: `ending.${endingKey}` })

    events = await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    const beforeEndingChoice = events.find(event => event.type === 'simulation.turn.ended' && event.sequence < endingBase.sequence)!
    const branch = await branchSimulationSession({ parentSessionId: session.id!, throughSequence: beforeEndingChoice.sequence, title: '治理分支' })
    const branchState = await readSimulationState(branch.id!)
    expect(branchState.lastSequence).toBe(0)
    expect(branchState.narrativeSimulation?.lastTurnEventSequences).toEqual([])
  }, 60_000)

  it('AI 表现候选只能引用已有事件与真实事实，不能泄漏调试报告或改写结算', () => {
    const content = createNarrativeSimulationAcceptanceContent()
    const run = runNarrativeSimulationBatch({ content, contentHash: 'd'.repeat(64), seed: 'ai-proof', turns: 1, decide: () => [] })
    const candidate = {
      kind: 'turn-briefing' as const,
      text: '局势仍在可解释规则内演化。',
      evidenceEventSequences: [run.events[0].sequence],
      assertedFacts: [{ source: 'resource' as const, key: 'funds', value: run.state.resources.funds }],
    }
    expect(validateNarrativeSimulationPresentationCandidate({ candidate, state: run.state, events: run.events })).toEqual(candidate)
    expect(() => validateNarrativeSimulationPresentationCandidate({
      candidate: { ...candidate, assertedFacts: [{ source: 'resource', key: 'funds', value: -999 }] },
      state: run.state,
      events: run.events,
    })).toThrow('事实冲突')
  })
})
