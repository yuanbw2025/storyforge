import { describe, expect, it, vi } from 'vitest'
import * as workspaceScope from '../../src/lib/workspace/scope'
import * as runEvents from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { isCodexExtractionLookupCandidateV2 } from '../../src/lib/agent/run/codex-extraction-v2-runtime'
import { readPendingCodexExtractionCandidateV2, readRecoverableCodexExtractionV2 } from '../../src/lib/agent/run/codex-extraction-durable'
import { createAgentSkillExecutionBindingV2, assertAgentSkillExecutionBindingIntegrityV2, type AgentSkillDefinitionV2 } from '../../src/lib/agent/execution-binding'
import { AGENT_SKILLS, AGENT_SKILL_BY_ID, getAgentSkillV1, validateAgentSkillDefinitionsV1, type AgentSkillDefinitionV1 } from '../../src/lib/agent/skill-registry'
import type { AgentSkillExecutionBindingV2 } from '../../src/lib/types/agent-run'
import { freezeFormalAIEntryBindingV1 } from '../../src/lib/agent/formal-ai-entry'
import { parseAgentRunContractV1, parseAgentRunContractV2, parseAgentRunContractV3, readRunBudgetSemanticsV2 } from '../../src/lib/agent/run/contract'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { codexEntryTransportOptionsV2, parseCodexAuthorDraftV2, parseCodexEntriesStrictV1, parseCodexEntriesStrictV2 } from '../../src/lib/ai/adapters/structured-extract-adapter'

const hash = 'a'.repeat(64)
const allocation = { version: 'task-budget-allocation-v2' as const, mode: 'adaptive-plan' as const, planHash: hash,
  inputBasis: 'prepared-complete-request-v2', outputBasis: 'source-token-estimate-v1', modelCallsBasis: 'remaining-exact-frontier-v2', hardConstraints: null }
function base() {
  return { version: 1, objective: 'isolated compatibility fixture', workflowKind: 'long-running-resumable',
    scope: { projectId: 1, worldGroupId: null }, runtimeBindingHash: hash,
    permissions: { contextSourceKeys: ['manualText'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'synthetic', criterionIds: ['output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } }
}
async function adaptive() {
  const binding = await createAgentSkillExecutionBindingV2(getAgentSkillV1('world-origin.codex-extract.v2'), {
    taskRequest: { version: 'task-request-binding-v2', planHash: hash, materialAllocationHash: 'b'.repeat(64) }, outputForecastTokens: 0 })
  return { ...base(), version: 3, executionBoundary: 'formal',
    permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets },
    executionBindings: [{ ...binding, stepId: 'world-origin:codex-extract-v2', formalEntry: await freezeFormalAIEntryBindingV1('world.codex.extract.v2') }],
    budget: { ...base().budget, maxModelCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, allocation } }
}
function row(name: string) {
  return { name, icon: '🌱', summary: '逐字来源', description: '完整描述', fields: {}, tags: [], importance: 2,
    evidenceQuotes: [], provenance: 'verbatim-extraction' as const }
}

// Mutate only supplied copies. Each label targets profile admission, not a hash,
// missing default Agent or duplicate-ID rejection from an unrelated guard.
function profileMutations(): [string, (definition: Omit<AgentSkillDefinitionV1, 'version'>) => void][] {
  return [
    ['identity', d => { d.id = 'world-origin.codex-fullcapture-forged-fixture' }],
    ['identity', d => { delete d.requestPolicy }],
    ['identity', d => { d.requestPolicy = 'unsupported' as never }],
    ['identity', d => { d.agentId = 'character' }],
    ['identity', d => { d.owner = 'another-owner' }],
    ['identity', d => { d.executionMode = 'story-core' }],
    ['identity', d => { d.contextTaskKind = 'agent-character' }],
    ['sources', d => { d.contextSourceKeys = ['manualText'] }],
    ['sources', d => { d.contextSourceKeys = [...d.contextSourceKeys, 'ragSelection'] }],
    ['sources', d => { d.contextSourceKeys = ['manualText', 'manualText'] }],
    ['sources', d => { d.contextSourceKeys = [...d.contextSourceKeys].reverse() }],
    ['sources', d => { d.optionalContextSourceKeys = ['ragSelection'] }],
    ['sources', d => { d.optionalContextSourceKeys = [] }],
    ['sources', d => { d.optionalContextSourceKeys = [...d.optionalContextSourceKeys, 'ragSelection'] }],
    ['sources', d => { d.inputPolicy.sourceKeys = ['manualText'] }],
    ['sources', d => { d.contextCompression.sourceKeys = [...d.contextCompression.sourceKeys, 'ragSelection'] }],
    ['inputPolicy', d => { d.inputPolicy.states.empty.handling = 'grounded-transform' }],
    ['readToolNames', d => { d.readToolNames = ['list_context_catalog'] }],
    ['Gateway', d => { delete d.contextGateway }],
    ['Gateway', d => { d.contextGateway!.providerSourceKeys = ['ragSelection'] }],
    ['Gateway', d => { d.contextGateway!.additionalReadToolNames = ['read_context_resource'] }],
    ['Gateway', d => { d.contextGateway!.allowedResourceKinds = ['chapter'] }],
    ['Gateway', d => { d.contextGateway!.allowedDepths = ['full'] }],
    ['Gateway', d => { d.contextGateway!.allowOriginalRead = false }],
    ['writeTargets', d => { d.writeTargets = [{ ...d.writeTargets[0], fields: [...d.writeTargets[0].fields, 'forgedField'] }] }],
    ['writeTargets', d => { d.writeTargets = [{ ...d.writeTargets[0], fields: ['name'] }] }],
    ['writeTargets', d => { d.writeTargets = [{ ...d.writeTargets[0], adoptionExtension: 'forged-self-consistent-extension' }] }],
    ['requiredWriteTargets', d => { d.contextGateway!.requiredWriteTargets = ['codexEntries.name'] }],
    ['requiredWriteTargets', d => { d.contextGateway!.requiredWriteTargets = [...d.contextGateway!.requiredWriteTargets!, 'codexEntries.forgedField'] }],
  ]
}

async function rehashFrozenFixture(binding: AgentSkillExecutionBindingV2, mutate: (definition: AgentSkillDefinitionV2) => void) {
  const definition: AgentSkillDefinitionV2 = JSON.parse(binding.skillDefinitionJson)
  mutate(definition)
  const policy = { version: 2, skillId: definition.id, readToolNames: definition.readToolNames,
    resolvedToolSourceKeys: definition.resolvedToolSourceKeys, contextSourceKeys: definition.contextSourceKeys,
    optionalContextSourceKeys: definition.optionalContextSourceKeys, inputPolicy: definition.inputPolicy,
    contextCompression: definition.contextCompression, ...(definition.contextGateway ? { contextGateway: definition.contextGateway } : {}),
    writeTargets: definition.writeTargets, ...(binding.taskRequest ? { taskRequest: binding.taskRequest } : {}) }
  return { ...binding, skillId: definition.id, promptVersion: definition.promptVersion,
    skillDefinitionJson: canonicalStringify(definition), skillDefinitionHash: await hashCanonicalValue(definition),
    contextAccessPolicyHash: await hashCanonicalValue(policy),
    contextSourceKeys: [...(definition.resolvedToolSourceKeys ?? []), ...definition.contextSourceKeys,
      ...definition.optionalContextSourceKeys.filter(key => binding.optionalContextActivations.some(item => item.sourceKey === key))],
    // Deliberately synchronize selected fields/extensions with the forged
    // declaration, so normalizeWriteTargets cannot be the accidental oracle.
    writeTargets: definition.writeTargets.map(target => ({ table: target.table, fields: [...target.fields],
      mode: 'author-confirmed' as const, ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}) }))
      .sort((left, right) => `${left.table}:${left.adoptionExtension ?? ''}`.localeCompare(`${right.table}:${right.adoptionExtension ?? ''}`)),
  }
}

describe('B01 C06/C07/C08/C09/C16/C17/C22/C25/C26/C30 · separate existing dialects', () => {
  it('preserves fixed, tool-only numeric, numeric service-only and registered reference-null V1 shapes', () => {
    const fixed = parseAgentRunContractV1(base())
    expect(readRunBudgetSemanticsV2(fixed).mode).toBe('legacy-fixed')
    const tool = parseAgentRunContractV1({ ...base(), permissions: { contextSourceKeys: [], writeTargets: [] },
      budget: { ...base().budget, maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0 } })
    expect(tool.budget.maxModelCalls).toBe(0)
    const service = parseAgentRunContractV1({ ...base(), budget: { ...base().budget, serviceCapacityOnly: true,
      maxModelCalls: 0, maxInputTokens: 0, maxOutputTokens: 0 } })
    expect(readRunBudgetSemanticsV2(service).mode).toBe('existing-service-capacity-only')
    const reference = { ...base(), permissions: { contextSourceKeys: ['referenceAnalysisPrivateChunk'], writeTargets: [] },
      executionBindings: [{ version: 1, skillId: 'inspiration.reference-analysis-private-chunk', skillVersion: 1,
        stepId: 'reference', promptVersion: 'v1', toolSchemaVersion: 'v1', toolSchemaHash: hash }],
      budget: { ...base().budget, capacityPolicy: 'service', maxModelCalls: null, maxInputTokens: null, maxOutputTokens: null } }
    const parsed = parseAgentRunContractV1(reference)
    expect(readRunBudgetSemanticsV2(parsed).mode).toBe('reference-service')
    expect(parseAgentRunContractV1(JSON.parse(canonicalStringify(parsed)))).toEqual(parsed)
    for (const budget of [{ ...reference.budget, maxInputTokens: 0 }, { ...reference.budget, serviceCapacityOnly: true }]) {
      expect(() => parseAgentRunContractV1({ ...reference, budget })).toThrow()
    }
    expect(() => parseAgentRunContractV1({ ...reference, permissions: base().permissions })).toThrow()
  })

  it('accepts numeric zero forecasts only through the exact new Skill/plan branch in V2 and V3', async () => {
    const contract = await adaptive(), parsed = parseAgentRunContractV3(contract)
    expect(readRunBudgetSemanticsV2(parsed).mode).toBe('adaptive-plan')
    const { executionBoundary: _boundary, ...v2 } = contract
    expect(parseAgentRunContractV2({ ...v2, version: 2 }).budget.allocation).toEqual(allocation)
    expect(() => parseAgentRunContractV1({ ...base(), budget: { ...base().budget, allocation } })).toThrow()
    for (const budget of [{ ...contract.budget, capacityPolicy: 'service' }, { ...contract.budget, serviceCapacityOnly: true },
      { ...contract.budget, maxInputTokens: null }, { ...contract.budget, maxOutputTokens: null }]) {
      expect(() => parseAgentRunContractV3({ ...contract, budget })).toThrow()
    }
    const changed = structuredClone(contract); changed.executionBindings[0].taskRequest!.planHash = 'c'.repeat(64)
    expect(() => parseAgentRunContractV3(changed)).toThrow()
    await expect(createAgentSkillExecutionBindingV2(getAgentSkillV1('world-origin.codex-extract'), {
      taskRequest: { version: 'task-request-binding-v2', planHash: hash, materialAllocationHash: hash }, outputForecastTokens: 0,
    })).rejects.toThrow()
    const skill = getAgentSkillV1('world-origin.codex-extract.v2')
    const live = (candidate: AgentSkillDefinitionV1) => AGENT_SKILLS.map(item => item.id === skill.id ? candidate : item)
    expect(() => validateAgentSkillDefinitionsV1(live(structuredClone(skill)))).not.toThrow()
    for (const [part, mutate] of profileMutations()) {
      const forged = structuredClone(skill); mutate(forged)
      expect(() => validateAgentSkillDefinitionsV1(live(forged))).toThrow(`full-capture profile ${part}`)
      await expect(createAgentSkillExecutionBindingV2(forged)).rejects.toThrow(`full-capture profile ${part}`)
    }
    const legacy = getAgentSkillV1('world-origin.codex-extract')
    for (const key of ['providerSourceKeys', 'additionalReadToolNames'] as const) {
      const forged = structuredClone(legacy); forged.contextGateway![key] = []
      expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS.map(item => item.id === legacy.id ? forged : item)))
        .toThrow(key === 'providerSourceKeys' ? 'provider source' : '追加读取工具')
    }
    const reservedLegacy = { ...structuredClone(legacy), id: skill.id }
    expect(() => validateAgentSkillDefinitionsV1(live(reservedLegacy))).toThrow('full-capture profile identity')
    const markedLegacy = { ...structuredClone(legacy), id: 'world-origin.unique-marked-legacy-fixture', requestPolicy: 'task-request-v2' as const }
    expect(() => validateAgentSkillDefinitionsV1(live(markedLegacy))).toThrow('full-capture profile identity')
    const taskRequest = { version: 'task-request-binding-v2' as const, planHash: hash, materialAllocationHash: 'b'.repeat(64) }
    const subset = await createAgentSkillExecutionBindingV2(skill, { taskRequest, outputForecastTokens: 0,
      writeTargets: [{ table: 'codexEntries', fields: ['name', 'summary'], mode: 'author-confirmed' }] })
    await expect(assertAgentSkillExecutionBindingIntegrityV2(subset)).resolves.toBeUndefined()
    const progress = await createAgentSkillExecutionBindingV2(skill, { taskRequest, outputForecastTokens: 0,
      optionalContextActivations: [{ sourceKey: 'codexExtractionProgressV2', reasonCode: 'explicit-runtime-boundary', boundaryHash: hash }] })
    expect(progress.contextSourceKeys).toEqual(['manualText', 'codexExtractionBaseline', 'codexExtractionProgressV2'])
    await expect(assertAgentSkillExecutionBindingIntegrityV2(progress)).resolves.toBeUndefined()
    await expect(createAgentSkillExecutionBindingV2(skill)).rejects.toThrow('plan/material')
    await expect(createAgentSkillExecutionBindingV2(skill, { taskRequest: { ...taskRequest, planHash: 'invalid' }, outputForecastTokens: 0 })).rejects.toThrow('完整请求Skill绑定')
  })

  it('preserves frozen model-capacity retrieval policy and rejects unknown mode or a forged new profile', async () => {
    const binding = await createAgentSkillExecutionBindingV2(getAgentSkillV1('world-origin.story-core'))
    await expect(assertAgentSkillExecutionBindingIntegrityV2(binding)).resolves.toBeUndefined()
    const definition = JSON.parse(binding.skillDefinitionJson)
    expect(definition.contextGateway.retrievalBudgetMode).toBe('model-capacity')
    definition.contextGateway.retrievalBudgetMode = 'unsupported'
    await expect(assertAgentSkillExecutionBindingIntegrityV2({ ...binding, skillDefinitionJson: canonicalStringify(definition) })).rejects.toThrow()
    const newBinding = (await adaptive()).executionBindings[0]
    await expect(assertAgentSkillExecutionBindingIntegrityV2({ ...newBinding, contextAccessPolicyHash: '0'.repeat(64) })).rejects.toThrow()
    await expect(assertAgentSkillExecutionBindingIntegrityV2(newBinding)).resolves.toBeUndefined()
    expect(newBinding.optionalContextActivations).toEqual([])
    for (const [part, mutate] of profileMutations()) {
      const forged = await rehashFrozenFixture(newBinding, mutate)
      await expect(assertAgentSkillExecutionBindingIntegrityV2(forged)).rejects.toThrow(`full-capture profile ${part}`)
    }
    for (const mutate of [
      (d: AgentSkillDefinitionV2) => { delete (d as Partial<AgentSkillDefinitionV2>).resolvedToolSourceKeys },
      (d: AgentSkillDefinitionV2) => { d.resolvedToolSourceKeys = ['ragSelection'] },
    ]) await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(newBinding, mutate)))
      .rejects.toThrow('full-capture profile resolvedToolSourceKeys')
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture({ ...newBinding, taskRequest: undefined }, () => {})))
      .rejects.toThrow('plan/material')
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture({ ...newBinding,
      taskRequest: { ...newBinding.taskRequest!, materialAllocationHash: 'invalid' } }, () => {})))
      .rejects.toThrow('完整请求Skill绑定')
    const legacy = await createAgentSkillExecutionBindingV2(getAgentSkillV1('world-origin.codex-extract'))
    await expect(assertAgentSkillExecutionBindingIntegrityV2(legacy)).resolves.toBeUndefined()
    for (const key of ['providerSourceKeys', 'additionalReadToolNames'] as const) {
      await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(legacy, d => { d.contextGateway![key] = [] })))
        .rejects.toThrow(`冻结 Context Gateway ${key}`)
    }
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(legacy, d => { d.id = newBinding.skillId })))
      .rejects.toThrow('full-capture profile identity')
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(legacy, d => { d.requestPolicy = 'task-request-v2' })))
      .rejects.toThrow('full-capture profile identity')
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(binding, d => { d.contextGateway!.retrievalBudgetMode = 'unsupported' as never })))
      .rejects.toThrow('retrievalBudgetMode')
    await expect(assertAgentSkillExecutionBindingIntegrityV2(await rehashFrozenFixture(binding, d => { d.contextGateway!.rollout = 'shadow' as never })))
      .resolves.toBeUndefined()
    const liveMap = AGENT_SKILL_BY_ID as Map<string, AgentSkillDefinitionV1>, saved = liveMap.get(newBinding.skillId)!
    try {
      liveMap.delete(newBinding.skillId)
      await expect(assertAgentSkillExecutionBindingIntegrityV2(newBinding)).resolves.toBeUndefined()
      await expect(assertAgentSkillExecutionBindingIntegrityV2(legacy)).resolves.toBeUndefined()
      liveMap.set(newBinding.skillId, { ...structuredClone(getAgentSkillV1('world-origin.codex-extract')), id: newBinding.skillId })
      await expect(assertAgentSkillExecutionBindingIntegrityV2(newBinding)).resolves.toBeUndefined()
      await expect(assertAgentSkillExecutionBindingIntegrityV2(legacy)).resolves.toBeUndefined()
    } finally { liveMap.set(newBinding.skillId, saved) }
    expect(liveMap.get(newBinding.skillId)).toBe(saved)
  })

  it('does not add Codex to the three reference-null source keys', () => {
    expect(CONTEXT_SOURCES.filter(source => source.budgetTokens === null).map(source => source.key).sort())
      .toEqual(['referenceAnalysisPrivateChunk','referenceDerivedBaseline','references'].sort())
    for (const key of ['manualText','codexExtractionBaseline']) {
      const source = CONTEXT_SOURCES.find(row => row.key === key)!
      expect(typeof source.budgetTokens).toBe('number')
      expect(source.fullCapture?.version).toBe('registered-host-full-v2')
    }
    expect(getAgentSkillV1('world-origin.codex-extract.v2').contextSourceKeys).toEqual(['manualText','codexExtractionBaseline'])
  })

  it('accepts 201 entries and long content in V2 while preserving V1 limits', () => {
    const entries = Array.from({ length: 201 }, (_, index) => ({ ...row(`花${index}`), summary: '摘录'.repeat(600),
      description: '完整描述'.repeat(2200), tags: Array.from({ length: 8 }, (_, at) => `标签${at}`) }))
    const sourceText = entries.map(entry => entry.name).join(' '), raw = JSON.stringify(entries)
    expect(parseCodexEntriesStrictV2(raw, [], { operation: 'extract', sourceText, supplementTags: true })).toHaveLength(201)
    expect(() => parseCodexEntriesStrictV1(raw, [], { operation: 'extract', sourceText })).toThrow()
    const options = codexEntryTransportOptionsV2({ provider: 'agnes', model: 'agnes-2.5-flash' }, [], { operation: 'extract', supplementTags: true })
    expect(JSON.stringify(options)).not.toContain('maxLength')
    expect(JSON.stringify(options)).not.toContain('maxItems')
  })

  it('grounds model names and supplied quotes in sent original range, retaining schema/finite/ref/type rejection', () => {
    const valid = row('月栖花'), policy = { operation: 'extract' as const, sourceText: '月栖花在此', supplementTags: false }
    expect(parseCodexEntriesStrictV2(JSON.stringify([valid]), [], policy)[0].evidenceQuotes).toEqual([])
    for (const bad of [{ ...valid, name: '基线独有名' }, { ...valid, evidenceQuotes: ['未发送尾段'] },
      { ...valid, importance: 8 }, { ...valid, tags: ['AI不得补'] }, { ...valid, fields: { ref: '1' } },
      { ...valid, refs: '{}' }, { ...valid, provenance: 'manual' }]) {
      expect(() => parseCodexEntriesStrictV2(JSON.stringify([bad]), [], policy)).toThrow()
    }
    expect(() => parseCodexEntriesStrictV2(JSON.stringify([{ ...valid, fields: { count: 'Infinity' } }]),
      [{ key: 'count', label: '数量', type: 'number' }], policy)).toThrow()
    const manual = { ...valid, name: '作者重命名', tags: ['作者手填'] }
    expect(parseCodexAuthorDraftV2(JSON.stringify([manual]), [], { sourceText: policy.sourceText, supplementTags: false })[0].name).toBe('作者重命名')
    expect(() => parseCodexAuthorDraftV2(JSON.stringify([{ ...manual, evidenceQuotes: ['不存在'] }]), [], policy)).toThrow()
  })

  it('does not allow extra allocation keys even when the sender recomputes a plausible hash', async () => {
    const contract = await adaptive()
    const hostile = { ...allocation, profile: 'reference-service', hash: await hashCanonicalValue(allocation) }
    expect(() => parseAgentRunContractV3({ ...contract, budget: { ...contract.budget, allocation: hostile } })).toThrow()
  })

  it.each([readPendingCodexExtractionCandidateV2, readRecoverableCodexExtractionV2])('freezes original Work and filter validation before asynchronous V2 lookup', async read => {
    const original = { projectId: 11, worldId: 22, workId: 33 }
    const filter = { scope: { ...original }, categoryId: 44, worldGroupId: null as number | null }
    const ownedRows = vi.spyOn(workspaceScope, 'readOwnedRows').mockResolvedValue([])
    try {
      const pending = read(filter)
      filter.scope.workId = 333; filter.categoryId = 444; filter.worldGroupId = 555
      expect(await pending).toBeNull()
      expect(ownedRows).toHaveBeenCalledWith(original, 'agentRuns', { owner: 'work' })
      await expect(read({ scope: original, categoryId: 0 })).rejects.toThrow('目标无效')
      expect(ownedRows).toHaveBeenCalledTimes(1)
    } finally { ownedRows.mockRestore() }
  })

  it('excludes a genuine unrelated V1 only through its actual same-Work verified ledger, leaving originals unchanged', async () => {
    await db.delete(); await db.open()
    const verifiedRead = vi.spyOn(runEvents, 'readAgentRunV1')
    const ownedRows = vi.spyOn(workspaceScope, 'readOwnedRows')
    try {
      const { scope } = await seedCurrentWorkspace('B01 genuine unrelated legacy ledger')
      const contract = parseAgentRunContractV1({ ...base(), scope: { projectId: scope.projectId, worldGroupId: null } })
      const created = await runEvents.createAgentRunV1({ scope, contract })
      const row = (await db.agentRuns.get(created.run.id))!
      const before = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }
      verifiedRead.mockClear(); ownedRows.mockClear()
      expect(await isCodexExtractionLookupCandidateV2(scope, row)).toBe(false)
      expect(verifiedRead).toHaveBeenCalledWith(scope, created.run.id)
      expect(ownedRows.mock.calls.some(([, table]) => table === 'agentRunEvents')).toBe(false)
      expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }).toEqual(before)
    } finally { verifiedRead.mockRestore(); ownedRows.mockRestore(); db.close() }
  })
})
