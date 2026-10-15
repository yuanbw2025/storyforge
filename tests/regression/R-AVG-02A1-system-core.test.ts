import { describe, expect, it } from 'vitest'
import { parseAvgSystemPlanV1, avgKnowledgePathV1, avgVariablePathV1 } from '../../src/lib/avg/system-contract'
import { compileAvgSystemPlanV1, simulateAvgSystemPlanV1 } from '../../src/lib/avg/system-compiler'
import { assertAvgSystemStateV1, previewAvgSystemEffectsV1 } from '../../src/lib/avg/system-state'
import { parseAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { parseAvgRuntimeModuleV1 } from '../../src/lib/avg/runtime-contract-v2'
import { avgLinearSystemFixture, avgSystemFixture } from '../helpers/avg-system-fixture'

describe('AVG-02A1 deterministic system core, independent of story production', () => {
  it('compiles portable rules and deterministic hashes without inventing story text or opening production', async () => {
    const plan = avgSystemFixture()
    const compiled = await compileAvgSystemPlanV1(JSON.stringify(plan))
    expect(compiled).toEqual(await compileAvgSystemPlanV1(plan))
    expect(compiled.planHash).toMatch(/^[a-f0-9]{64}$/)
    expect(compiled.narrative.beats).toEqual([])
    expect(compiled.narrative.choices.map(choice => choice.choiceKey)).toEqual(['inspect','share','wait'])
    const revised = structuredClone(plan); revised.actions[0].label = '观察封口'
    expect((await compileAvgSystemPlanV1(revised)).planHash).not.toBe(compiled.planHash)
    expect(() => parseAvgProfessionalArtifactV1(plan)).toThrow(/尚未就绪/)
    expect(() => parseAvgRuntimeModuleV1(plan)).toThrow()
  })

  it('separates player and character knowledge, keeps repeated visits, and applies consequences before the target guard', async () => {
    const plan = avgSystemFixture(), before = JSON.stringify(plan)
    const preview = await simulateAvgSystemPlanV1({ plan, actionKeys: ['inspect','share'] })
    expect(preview.completed).toBe(true)
    expect(preview.steps.map(step => step.currentNodeKey)).toEqual(['desk','desk','handover'])
    expect(preview.steps[0].availableChoiceKeys).toEqual(['inspect','wait'])
    expect(preview.steps[1].variables).toEqual({ avg: {
      variables: { attempts: 1, phase: 'checked', note: '', promised: false },
      knowledge: { player: { seal: true }, keeper: { seal: false } }, relationships: { keeper: { trust: 0 } },
    } })
    expect(preview.steps[1].visibleChoiceKeys).toContain('inspect')
    expect(preview.steps[1].availableChoiceKeys).not.toContain('inspect')
    expect(preview.steps[2].variables).toEqual({ avg: {
      variables: { attempts: 1, phase: 'checked', promised: true },
      knowledge: { player: { seal: true }, keeper: { seal: true } }, relationships: { keeper: { trust: 1 } },
    } })
    expect(preview.steps[2].choiceHistory.map(item => item.choiceKey)).toEqual(['inspect','share'])
    expect(preview.steps[2].visitedNodeKeys).toEqual(['desk','desk','handover'])
    expect(preview.steps[2].endingKey).toBe('handover')
    expect(JSON.stringify(plan)).toBe(before)
    expect(await simulateAvgSystemPlanV1({ plan, actionKeys: ['inspect','share'] })).toEqual(preview)
  })

  it('supports a different linear rules fixture and partial preview without any character/knowledge records', async () => {
    const plan = avgLinearSystemFixture()
    expect((await simulateAvgSystemPlanV1({ plan, actionKeys: [] })).completed).toBe(false)
    const result = await simulateAvgSystemPlanV1({ plan, actionKeys: ['switch'] })
    expect(result.steps[1].variables).toEqual({ avg: { variables: { lit: true } } })
    expect(result.completed).toBe(true)
    expect((await simulateAvgSystemPlanV1({ plan: avgSystemFixture(), actionKeys: ['wait'] })).steps[1].variables.avg).toMatchObject({ knowledge: { player: { seal: false }, keeper: { seal: false } } })
  })

  it('rejects unavailable, repeated, unknown and post-ending actions', async () => {
    for (const actionKeys of [['share'], ['inspect','inspect'], ['unknown'], ['wait','inspect']]) {
      await expect(simulateAvgSystemPlanV1({ plan: avgSystemFixture(), actionKeys })).rejects.toThrow()
    }
    const hidden = avgSystemFixture(); hidden.actions[1].visibleWhen = { path: 'avg.knowledge.player.seal', eq: true }
    const preview = await simulateAvgSystemPlanV1({ plan: hidden, actionKeys: [] })
    expect(preview.steps[0].visibleChoiceKeys).not.toContain('share')
  })

  it('rejects dynamic overflow and target-guard failures atomically, leaving source and earlier previews unchanged', async () => {
    const plan = avgSystemFixture()
    const prior = await simulateAvgSystemPlanV1({ plan, actionKeys: [] }), snapshot = JSON.stringify(prior)
    plan.actions[0].effects.push({ op: 'increment', path: 'avg.variables.attempts', value: 2 })
    const source = JSON.stringify(plan)
    await expect(simulateAvgSystemPlanV1({ plan, actionKeys: ['inspect'] })).rejects.toThrow(/attempts/)
    expect(JSON.stringify(plan)).toBe(source)
    expect(JSON.stringify(prior)).toBe(snapshot)
    plan.actions[0].effects.push({ op: 'increment', path: 'avg.variables.attempts', value: -2 })
    await expect(simulateAvgSystemPlanV1({ plan, actionKeys: ['inspect'] })).rejects.toThrow(/attempts/)
    const blocked = avgSystemFixture()
    blocked.actions[1].effects = blocked.actions[1].effects.filter(effect => effect.path !== 'avg.knowledge.keeper.seal')
    await expect(simulateAvgSystemPlanV1({ plan: blocked, actionKeys: ['inspect','share'] })).rejects.toThrow(/条件未满足/)
    const entryOverflow = avgSystemFixture()
    entryOverflow.scenes[0].onEnter = [{ op: 'increment', path: 'avg.relationships.keeper.trust', value: 3 }]
    await expect(simulateAvgSystemPlanV1({ plan: entryOverflow, actionKeys: [] })).rejects.toThrow(/trust/)
  })

  it('rejects unknown writes, wrong types, invalid bounds and missing required values', async () => {
    const compiled = await compileAvgSystemPlanV1(avgSystemFixture())
    for (const effect of [
      { op: 'set', path: 'avg.variables.unknown', value: true }, { op: 'set', path: 'avg.variables.phase', value: 'opened' },
      { op: 'set', path: 'avg.variables.attempts', value: 0.5 }, { op: 'increment', path: 'avg.variables.promised', value: 1 },
      { op: 'increment', path: 'avg.variables.attempts', value: 0.5 }, { op: 'unset', path: 'avg.knowledge.player.seal' },
      { op: 'set', path: 'avg.variables.note', value: 'x'.repeat(21) }, { op: 'set', path: 'avg.variables.attempts', value: Infinity },
      { op: 'set', path: 'clock', value: 2 }, { op: 'set', path: 'avg.variables.promised', value: {} },
    ]) {
      const plan = avgSystemFixture(); (plan.actions[0].effects as unknown[]) = [effect]
      expect(() => parseAvgSystemPlanV1(plan)).toThrow()
    }
    expect(() => assertAvgSystemStateV1(compiled.plan, { ...compiled.initialVariables, clock: 1 })).toThrow(/未声明/)
    expect(() => assertAvgSystemStateV1(compiled.plan, {})).toThrow(/缺少必需/)
    expect(() => assertAvgSystemStateV1(compiled.plan, { avg: [] })).toThrow(/容器/)
    expect(() => previewAvgSystemEffectsV1(compiled.plan, compiled.initialVariables, [{ op: 'set', path: 'avg.variables.__proto__.avgPolluted', value: true }])).toThrow(/path/)
    expect((Object.prototype as Record<string, unknown>).avgPolluted).toBeUndefined()
    expect(() => previewAvgSystemEffectsV1(compiled.plan, { clock: 1 }, [])).toThrow(/未声明/)
  })

  it('rejects wrong comparison types and unknown state, holder, history and identity references', () => {
    for (const predicate of [{ path: 'avg.variables.attempts', eq: '1' }, { path: 'avg.variables.phase', in: ['sealed','missing'] },
      { path: 'avg.knowledge.unknown.seal', eq: true }, { visited: 'missing' }, { selected: 'missing' }, { code: 'eval()' }]) {
      const plan = avgSystemFixture(); plan.actions[0].enabledWhen = predicate as never
      expect(() => parseAvgSystemPlanV1(plan)).toThrow()
    }
    for (const key of ['x.y','__proto__','constructor','prototype']) expect(() => avgVariablePathV1(key)).toThrow()
    expect(avgKnowledgePathV1('player','seal')).not.toBe(avgKnowledgePathV1('keeper','seal'))
    const plan = avgSystemFixture(); plan.knowledge[0].holderKey = 'unknown'
    expect(() => parseAvgSystemPlanV1(plan)).toThrow(/holder/)
    plan.knowledge[0].holderKey = 'player'; plan.characters[0].key = 'player'
    expect(() => parseAvgSystemPlanV1(plan)).toThrow(/保留身份/)
  })

  it('rejects malformed graphs: orphan/dead/unreachable scenes, no exit, incorrect entry and forbidden linear branching', async () => {
    const mutate = [
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.actions[0].toSceneKey = 'missing' },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.actions[0].fromSceneKey = 'missing' },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.actions = plan.actions.filter(action => action.key !== 'share') },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.actions = plan.actions.slice(0, 1); plan.scenes = plan.scenes.slice(0, 1) },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.entrySceneKey = 'wait' },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.storyMode = 'linear' },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.scenes[1].kind = 'scene' },
      (plan: ReturnType<typeof avgSystemFixture>) => { plan.actions[0].fromSceneKey = 'wait' },
    ]
    for (const change of mutate) { const plan = avgSystemFixture(); change(plan); await expect(compileAvgSystemPlanV1(plan)).rejects.toThrow() }
  })

  it('fails closed on unknown fields, duplicate identities, sparse/unbounded data and excessive condition depth', async () => {
    const plan = avgSystemFixture()
    for (const invalid of [{ ...plan, version: 2 }, { ...plan, workId: 1 }, { ...plan, ready: true },
      { ...plan, variables: [...plan.variables, plan.variables[0]] }, { ...plan, knowledge: [...plan.knowledge, plan.knowledge[0]] },
      { ...plan, actions: [...plan.actions, plan.actions[0]] }, { ...plan, scenes: new Array(1) },
      { ...plan, variables: [{ ...plan.variables[0], initial: -1 }] },
      { ...plan, variables: [{ key: 'choice', kind: 'enum', initial: 'a', values: [], optional: false }] },
      { ...plan, actions: [{ ...plan.actions[0], unavailableReason: '' }, ...plan.actions.slice(1)] },
    ]) expect(() => parseAvgSystemPlanV1(invalid)).toThrow()
    let predicate: unknown = {}; for (let index = 0; index < 20; index++) predicate = { not: predicate }
    plan.actions[0].visibleWhen = predicate as never
    expect(() => parseAvgSystemPlanV1(plan)).toThrow(/复杂度/)
    await expect(simulateAvgSystemPlanV1({ plan: avgSystemFixture(), actionKeys: new Array(1001).fill('inspect') })).rejects.toThrow(/有界/)
  })

  it('bounds the combined effect/state work of a large but individually valid preview', async () => {
    const plan = avgSystemFixture()
    plan.variables = Array.from({ length: 500 }, (_, index) => ({ key: `flag${index}`, kind: 'boolean', initial: false, optional: false }))
    plan.scenes[2].enterWhen = {}
    plan.actions[0].enabledWhen = {}
    plan.actions[0].effects = Array.from({ length: 100 }, () => ({ op: 'set', path: 'avg.variables.flag0', value: true }))
    plan.actions[1].effects = []
    await expect(simulateAvgSystemPlanV1({ plan, actionKeys: new Array(21).fill('inspect') })).rejects.toThrow(/预算超限/)
  })
})
