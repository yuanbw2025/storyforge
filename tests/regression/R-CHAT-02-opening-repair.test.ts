import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionDetailsV1, confirmChatSituationDecisionV1} from '../../src/lib/product-production/service'
import {planChatOpeningRepairV1, validateChatOpeningRepairV1} from '../../src/lib/character-interaction/opening-repair'
import {readChatOpeningAutomaticRepairFeedbackV1} from '../../src/lib/character-interaction/opening-repair-evidence'
import {chatOpeningProofReviewFixture, chatOpeningDevelopmentReviewFixture, chatSituationCandidatesFixture, chatSituationReferenceDraftFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import type {ChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'
import * as plans from '../../src/lib/product-production/plan'
import * as skills from '../../src/lib/agent/skill-registry'
import {CHAT_OPENING_REPAIR_GATE_V1} from '../../src/lib/character-interaction/opening-repair'
import {CHAT_OPENING_REPAIR_GATE_V2, planChatOpeningRepairV2, applyChatOpeningRepairPatchV1} from '../../src/lib/character-interaction/opening-repair-patch'
import {CHAT_OPENING_FACT_CATALOG_KEY, CHAT_OPENING_REFERENCE_GATE_V1, CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1} from '../../src/lib/character-interaction/opening-source-references'
import {CHAT_OPENING_OPTION_REPAIR_GATE_V1} from '../../src/lib/character-interaction/opening-option-repair'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatOpeningReferencePromptV3} from '../../src/lib/character-interaction/opening-option-repair'
import {estimateTokens} from '../../src/lib/ai/context-budget'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})

function withWorldFact(source: ChatNarrativeProductionSourceV1) {
  const candidates = chatSituationCandidatesFixture(source)
  const knowledge = source.source.knowledge.find(item => item.source.purpose === 'identity' && item.audienceKeys.includes('player'))!
  candidates.options[0].situation.facts.push({
    factKey: 'known-identity', text: knowledge.content, audienceKeys: [...knowledge.audienceKeys],
    origin: 'reviewed-world', sourceKnowledgeKey: knowledge.key, sourceEventSequence: 0,
  })
  return candidates
}

it('locates exact source corrections, preserves all other content, and never broadens a repair into creative rewriting', async () => {
  const f = await seedChatNarrativeProductionFixture()
  const valid = withWorldFact(f.source), invalid = structuredClone(valid)
  const fact = invalid.options[0].situation.facts.at(-1)!
  fact.origin = 'author-private'; fact.text = '改写过的身份'
  const raw = JSON.stringify(invalid)
  const repair = (await planChatOpeningRepairV1(raw, f.source, '事实来源错误'))!
  expect(repair.repairs.map(item => item.path)).toEqual(['/options/0/situation/facts/1/origin', '/options/0/situation/facts/1/text'])
  await expect(validateChatOpeningRepairV1({raw, repair, candidate: valid, source: f.source})).resolves.toBeUndefined()
  for (const mutation of ['plot', 'private', 'audience', 'remove', 'source'] as const) {
    const changed = structuredClone(valid)
    if (mutation === 'plot') changed.options[0].situation.goals[0].desire = '放弃原目标'
    if (mutation === 'private') {changed.options[0].situation.facts.at(-1)!.origin = 'author-private'; changed.options[0].situation.facts.at(-1)!.sourceKnowledgeKey = null}
    if (mutation === 'audience') changed.options[0].situation.facts.at(-1)!.audienceKeys = []
    if (mutation === 'remove') changed.options[0].situation.facts.pop()
    if (mutation === 'source') changed.options[0].situation.facts.at(-1)!.sourceKnowledgeKey = 'invented'
    await expect(validateChatOpeningRepairV1({raw, repair, candidate: changed, source: f.source})).rejects.toThrow('错误路径之外')
  }
  await expect(validateChatOpeningRepairV1({raw: raw + ' ', repair, candidate: valid, source: f.source})).rejects.toThrow('不一致')
  await expect(validateChatOpeningRepairV1({raw, repair: {...repair, sourceHash: '0'.repeat(64)}, candidate: valid, source: f.source})).rejects.toThrow('不一致')
})

it('allows only missing options to be appended; malformed, unknown-source and visibility failures are not automatic repair authority', async () => {
  const f = await seedChatNarrativeProductionFixture(), valid = withWorldFact(f.source)
  const short = {...valid, options: valid.options.slice(0, 1)}
  const raw = JSON.stringify(short), repair = (await planChatOpeningRepairV1(raw, f.source, '数量不符'))!
  expect(repair.missingOptions).toBe(2)
  await expect(validateChatOpeningRepairV1({raw, repair, candidate: valid, source: f.source})).resolves.toBeUndefined()
  const reversed = {...valid, options: [...valid.options].reverse()}
  await expect(validateChatOpeningRepairV1({raw, repair, candidate: reversed, source: f.source})).rejects.toThrow()
  expect(await planChatOpeningRepairV1('{', f.source, 'JSON')).toBeNull()
  for (const mutation of ['source', 'voice', 'visibility', 'unrelated'] as const) {
    const bad = structuredClone(valid), fact = bad.options[0].situation.facts.at(-1)!
    if (mutation === 'source') fact.sourceKnowledgeKey = 'unknown'
    if (mutation === 'voice') fact.sourceKnowledgeKey = f.source.source.knowledge.find(item => item.source.purpose === 'voice')!.key
    if (mutation === 'visibility') fact.audienceKeys.push('unknown')
    if (mutation === 'unrelated') bad.options[0].situation.goals[0].actorKey = 'unknown'
    expect(await planChatOpeningRepairV1(JSON.stringify(bad), f.source, mutation)).toBeNull()
  }
})

it('repairs a misplaced complete option without regenerating either retained story or source text', async () => {
  const f = await seedChatNarrativeProductionFixture(), valid = withWorldFact(f.source)
  const first = structuredClone(valid.options[0])
  first.situation.facts.at(-1)!.origin = 'author-private'
  first.situation.facts.at(-1)!.text = '省略了来源原文的引号'
  const raw = JSON.stringify({...valid, options: [first], ...valid.options[1]})
  const repair = (await planChatOpeningRepairV2(raw, f.source, '字段无效'))!
  expect(repair).toMatchObject({version: 2, recoverRootOption: true, originalOptionCount: 2, missingOptions: 1})
  const patch = {schema: 'storyforge.chat-opening-repair-patch', version: 1, rawResponseHash: repair.rawResponseHash,
    recoverRootOption: true, applyRepairs: repair.repairs.map(item => item.path), appendedOptions: [valid.options[2]]}
  expect(await applyChatOpeningRepairPatchV1({raw, repair, source: f.source, candidate: patch})).toEqual(valid)
  for (const mutation of ['whole', 'extra', 'path', 'duplicate', 'missing', 'move', 'hash', 'invalid-new-option', 'same-option'] as const) {
    const bad = structuredClone(patch)
    if (mutation === 'extra') Object.assign(bad, {title: '重写已有剧情'})
    if (mutation === 'path') bad.applyRepairs.push('/options/0/title')
    if (mutation === 'duplicate') bad.applyRepairs.push(bad.applyRepairs[0])
    if (mutation === 'missing') bad.applyRepairs.pop()
    if (mutation === 'move') bad.recoverRootOption = false
    if (mutation === 'hash') bad.rawResponseHash = '0'.repeat(64)
    if (mutation === 'invalid-new-option') bad.appendedOptions[0].situation.goals[0].actorKey = 'foreign'
    if (mutation === 'same-option') bad.appendedOptions = [valid.options[0]]
    await expect(applyChatOpeningRepairPatchV1({raw, repair, source: f.source, candidate: mutation === 'whole' ? valid : bad})).rejects.toThrow()
  }
  await expect(applyChatOpeningRepairPatchV1({raw: raw + ' ', repair, source: f.source, candidate: patch})).rejects.toThrow('不一致')
  for (const mutation of ['unknown-field', 'partial-root', 'invalid-retained', 'duplicate-root', 'player-scheduling', 'private-thread-evidence'] as const) {
    const bad = {...valid, options: [first], ...structuredClone(valid.options[1])} as Record<string, unknown>
    if (mutation === 'unknown-field') bad.future = '不能丢弃的另一个故事'
    if (mutation === 'partial-root') delete bad.pitch
    if (mutation === 'invalid-retained') (bad.situation as typeof first.situation).goals[0].actorKey = 'foreign'
    if (mutation === 'duplicate-root') Object.assign(bad, first)
    if (mutation === 'player-scheduling') (bad.situation as typeof first.situation).threads[0].participantKeys.push('player')
    if (mutation === 'private-thread-evidence') (bad.situation as typeof first.situation).facts[0].audienceKeys = ['participant.001']
    expect(await planChatOpeningRepairV2(JSON.stringify(bad), f.source, mutation)).toBeNull()
  }
})

it.each(['repair', 'missing', 'misplaced', 'repeat-error', 'rewrite', 'budget', 'output-budget', 'schema-budget', 'transport', 'legacy', 'legacy-v7', 'legacy-v8', 'missing-feedback', 'source-changed', 'foreign-epoch',
  'refs-missing', 'refs-misplaced', 'refs-repeat-error', 'refs-private', 'refs-private-repeat', 'refs-private-rewrite', 'refs-private-v9', 'refs-private-v10', 'refs-private-review',
  'refs-missing-catalog', 'refs-missing-delivery', 'refs-tampered-delivery', 'refs-stale-source'] as const)(
  'runs one budgeted targeted repair through the durable production chain (%s)', async scenario => {
    const referenceWire = scenario.startsWith('refs-')
    const preflightRejected = ['schema-budget', 'refs-missing-catalog', 'refs-missing-delivery', 'refs-tampered-delivery', 'refs-stale-source'].includes(scenario)
    if (scenario === 'legacy' || scenario === 'legacy-v7' || scenario === 'legacy-v8' || scenario === 'refs-private-v9' || scenario === 'refs-private-v10') {
      const createPlan = plans.createProductProductionPlanV3, readSkill = skills.getAgentSkillV1
      vi.spyOn(plans, 'createProductProductionPlanV3').mockImplementation(async input => {
        const plan = await createPlan(input), task = plan.tasks.find(item => item.taskKey === 'content.product-module')!
        task.acceptanceGateIds = task.acceptanceGateIds.filter(id => id !== 'chat.opening-development.v3')
        for (const entry of plan.tasks) entry.acceptanceGateIds = entry.acceptanceGateIds.filter(id => id !== CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1)
        if (scenario === 'refs-private-v10') return plan
        task.acceptanceGateIds = task.acceptanceGateIds.filter(id => id !== CHAT_OPENING_OPTION_REPAIR_GATE_V1)
        if (scenario === 'refs-private-v9') return plan
        task.acceptanceGateIds = task.acceptanceGateIds.filter(id => ![CHAT_OPENING_REPAIR_GATE_V1, CHAT_OPENING_REPAIR_GATE_V2, CHAT_OPENING_REFERENCE_GATE_V1].includes(id))
        if (scenario === 'legacy-v7') task.acceptanceGateIds.push(CHAT_OPENING_REPAIR_GATE_V1)
        else if (scenario === 'legacy-v8') task.acceptanceGateIds.push(CHAT_OPENING_REPAIR_GATE_V2)
        else task.budgetReservation.modelCalls = 1
        task.inputArtifactKeys = task.inputArtifactKeys.filter(key => key !== CHAT_OPENING_FACT_CATALOG_KEY)
        const design = plan.tasks.find(t => t.taskKey === 'content.design')!
        design.outputArtifactKeys = design.outputArtifactKeys.filter(key => key !== CHAT_OPENING_FACT_CATALOG_KEY)
        design.subjectLockKeys = design.subjectLockKeys.filter(key => key !== CHAT_OPENING_FACT_CATALOG_KEY)
        return plan
      })
      vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
        const skill = readSkill(id)
        return id === 'character.chat-situation-production' ? {...skill, promptVersion: scenario === 'refs-private-v10' ? 'chat-situation-production-v10' : scenario === 'refs-private-v9' ? 'chat-situation-production-v9' : scenario === 'legacy-v8' ? 'chat-situation-production-v8' : scenario === 'legacy-v7' ? 'chat-situation-production-v7' : 'chat-situation-production-v6'} : skill
      })
    }
    const f = await seedChatNarrativeProductionFixture({worldDiscovery: referenceWire})
    const worldBefore = await db.worldReleases.get(f.confirmed.worldReleaseId!)
    const created = await executeProductProductionCommand({scope: f.scope, command: {
      type: 'create-intent', commandId: 'auto.create', productionKey: 'auto.chat', productType: 'character-interaction',
      worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作角色聊天',
    }})
    expect(created.ok).toBe(true)
    const productionId = created.productionId
    const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {
      type: 'save-brief-revision', commandId: 'auto.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief,
    }})
    const started = await executeProductProductionCommand({scope: f.scope, productionId, command: {
      type: 'authorize-start', commandId: 'auto.start', expectedStateRevision: 1, briefRevision: 1,
      briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start',
    }})
    expect(started.ok).toBe(true)
    const requirementKey = f.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!.requirementKey
    const bindingHash = 'a'.repeat(64), calls: Array<{kind: string; context: string; limit: number}> = []
    let originalRaw = ''
    const runText: ProductionTextRunnerV1 = async request => {
      const isOpening = request.system.includes('初始情境编辑')
      const legacy = ['legacy', 'legacy-v7', 'legacy-v8', 'refs-private-v9', 'refs-private-v10'].includes(scenario)
      if (isOpening && !calls.length && !legacy) expect(request.jsonSchema).toMatchObject({name: 'chat_opening_source_complete_v1', strict: true})
      else if (!isOpening) expect(request.jsonSchema).toMatchObject({name: 'chat_opening_review_relations_v1', strict: true})
      else expect(request.jsonSchema).toBeUndefined()
      calls.push({kind: isOpening ? 'opening' : 'review', context: request.contextText, limit: request.maximumOutputTokens})
      if (scenario === 'transport') throw Object.assign(new Error('HTTP 403 forbidden'), {status: 403})
      const sourceRow = await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKey === 'design.game').last()
      const source = JSON.parse(sourceRow!.payloadJson) as ChatNarrativeProductionSourceV1
      const candidates = withWorldFact(source)
      if (!referenceWire && isOpening && (calls.length === 1 || scenario === 'repeat-error')) {
        if (scenario === 'missing') candidates.options = candidates.options.slice(0, 1)
        else candidates.options[0].situation.facts.at(-1)!.origin = 'author-private'
      }
      if (scenario === 'rewrite' && calls.length === 2) candidates.options[0].title = '偷偷重写整个开场'
      const references = referenceWire ? await chatSituationReferenceDraftFixture(source, candidates) : null
      const reviewed = !isOpening ? JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson) : candidates
      let payload: unknown = isOpening ? references ?? candidates : chatOpeningProofReviewFixture(source, reviewed, chatOpeningDevelopmentReviewFixture(reviewed, scenario === 'refs-private-review' ? reviewed.options[2].optionKey : undefined))
      if (references && isOpening && calls.length === 1) {
        if (scenario.startsWith('refs-private')) {
          references.options[2].situation.localFacts[0].audienceKeys = ['participant.001']
          payload = references
        } else payload = {...references, options: references.options.slice(0, 1),
          ...(scenario === 'refs-misplaced' ? references.options[1] : {})}
      }
      if (isOpening && calls.length === 1 && scenario === 'misplaced') payload = {...candidates, options: candidates.options.slice(0, 1), ...candidates.options[1]}
      if (isOpening && calls.length === 2 && scenario !== 'legacy-v7') {
        const repair = request.contextText.split(/\n\s*\n/g).flatMap(segment => {
          try {const value = JSON.parse(segment); return value.automaticOpeningRepair ? [value.automaticOpeningRepair] : []} catch {return []}
        })[0]
        payload = {schema: 'storyforge.chat-opening-repair-patch', version: 1, rawResponseHash: repair.rawResponseHash,
          recoverRootOption: repair.recoverRootOption,
          applyRepairs: scenario === 'repeat-error' ? [] : repair.repairs.map((item: {path: string}) => item.path),
          appendedOptions: scenario === 'refs-repeat-error' ? [] : (references ?? candidates).options.slice(repair.originalOptionCount),
          ...((repair.version === 4 || repair.version === 5) && repair.format === 'references' ? {version: 2, replacementOptions: repair.invalidOptions.map((item: {optionIndex: number}) => {
            const index = scenario === 'refs-private-rewrite' ? 0 : item.optionIndex
            const option = structuredClone(references!.options[index])
            if (scenario === 'refs-private-repeat') option.situation.localFacts[0].audienceKeys = ['participant.001']
            return {optionIndex: index, option}
          })} : {}),
          ...(scenario === 'rewrite' ? {options: candidates.options} : {}),
        }
      }
      const output = JSON.stringify(payload)
      if (calls.length === 1) originalRaw = output
      return {output, usage: {inputTokens: scenario === 'budget' ? 29_999 : 100, outputTokens: scenario === 'output-budget' ? 14_999 : 100}, bindingReceipt: {
        schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
        provider: 'fixture', model: 'fixture', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
        credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
      }}
    }
    const configured = createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief: f.brief, runText})
    const execute = () => runProductProductionUntilBlockedV1({
      scope: f.scope, productionId, capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}],
      executor: async input => {
        if (input.task.taskKey === 'content.product-module' && preflightRejected) {
          if (scenario === 'schema-budget') return configured({...input, attemptBudgetReservation: {
            ...input.attemptBudgetReservation!, inputTokens: estimateTokens(input.contextText + chatOpeningReferencePromptV3()),
          }})
          if (scenario === 'refs-missing-catalog') return configured({...input,
            inputArtifacts: input.inputArtifacts.filter(row => row.artifactKey !== CHAT_OPENING_FACT_CATALOG_KEY)})
          if (scenario === 'refs-stale-source') {
            const inputArtifacts = structuredClone(input.inputArtifacts)
            const design = inputArtifacts.find(row => row.artifactKey === 'design.game')!
            const source = JSON.parse(design.payloadJson)
            source.settings.openingSituation += '新的情境'
            design.payloadJson = JSON.stringify(source)
            return configured({...input, inputArtifacts})
          }
          const contextText = input.contextText.split(/\n\s*\n/g).map(segment => {
            let packet
            try {packet = JSON.parse(segment)} catch {return segment}
            if (packet.schema !== 'storyforge.product-production.artifact-inputs') return segment
            if (scenario === 'refs-missing-delivery') packet.artifacts = packet.artifacts.filter((row: {artifactKey: string}) => row.artifactKey !== CHAT_OPENING_FACT_CATALOG_KEY)
            else packet.artifacts.find((row: {artifactKey: string}) => row.artifactKey === CHAT_OPENING_FACT_CATALOG_KEY).payload.sourceHash = '0'.repeat(64)
            return JSON.stringify(packet)
          }).join('\n\n')
          return configured({...input, contextText})
        }
        if (input.task.taskKey === 'content.product-module' && input.attempt === 2) {
          if (scenario === 'missing-feedback') return configured({...input, contextText: '{}'})
          if (scenario === 'source-changed') {
            const inputArtifacts = structuredClone(input.inputArtifacts)
            const design = inputArtifacts.find(item => item.artifactKey === 'design.game')!
            const source = JSON.parse(design.payloadJson)
            source.settings.openingSituation += '另一个局面'
            design.payloadJson = JSON.stringify(source)
            return configured({...input, inputArtifacts})
          }
          if (scenario === 'foreign-epoch') {
            const build = (await db.productBuilds.get(input.buildId))!
            await expect(readChatOpeningAutomaticRepairFeedbackV1({scope: f.scope, build: {...build, controlEpoch: build.controlEpoch + 1}, taskKey: input.task.taskKey})).rejects.toThrow('完整原始证据')
          }
        }
        return configured(input)
      },
    })
    await execute()
    const details = await readProductProductionDetailsV1(f.scope, productionId)
    const passed = ['repair', 'missing', 'misplaced', 'legacy-v7', 'legacy-v8', 'foreign-epoch', 'refs-missing', 'refs-misplaced', 'refs-private', 'refs-private-v10', 'refs-private-review'].includes(scenario)
    const noSecondCall = preflightRejected || ['budget', 'output-budget', 'transport', 'legacy', 'missing-feedback', 'source-changed', 'refs-private-v9'].includes(scenario)
    expect(calls.map(call => call.kind), details.build!.failureJson).toEqual(preflightRejected ? [] : passed ? ['opening', 'opening', 'review'] : noSecondCall ? ['opening'] : ['opening', 'opening'])
    expect(JSON.parse(details.build!.failureJson)).toMatchObject(passed ? {taskKey: 'content.chat-author-gate'} : {taskKey: 'content.product-module'})
    if (scenario === 'refs-private-review') {
      const review = JSON.parse((await db.productBuildArtifacts.filter(row => row.buildId === details.build!.id && row.artifactKey === 'quality.chat-openings').last())!.payloadJson)
      expect(review.options[2].checks.some((check: {passed: boolean}) => !check.passed)).toBe(true)
      await expect(confirmChatSituationDecisionV1({scope: f.scope, details, candidatesHash: review.candidatesHash, sourceHash: review.sourceHash, selectedOptionKey: review.options[2].optionKey})).rejects.toThrow()
      expect(await db.productBuildArtifacts.filter(row => row.buildId === details.build!.id && row.artifactKey === 'content.chat-selection').count()).toBe(0)
    }
    if (!noSecondCall) {
      expect(calls[1].context).toContain('"automaticOpeningRepair"')
      expect(calls[1].context).toContain(JSON.stringify(originalRaw))
      expect(calls[1].limit).toBeLessThan(calls[0].limit)
    }
    const attempts = JSON.parse(details.build!.budgetLedgerJson).attempts.filter((item: {taskKey: string}) => item.taskKey === 'content.product-module')
    if (preflightRejected) expect(attempts[0]).toMatchObject({attempt: 1, outcome: 'failed', usageKnown: true, usage: {modelCalls: 0}})
    else if (scenario !== 'transport') {
      expect(attempts[0]).toMatchObject({attempt: 1, outcome: 'failed', usageKnown: true, usage: {modelCalls: 1}})
      expect(await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).filter(row => row.artifactKind === 'raw-response' && row.content === originalRaw).count()).toBe(1)
    }
    await execute()
    expect(calls).toHaveLength(preflightRejected ? 0 : passed ? 3 : noSecondCall ? 1 : 2)
    expect(await db.worldReleases.get(f.confirmed.worldReleaseId!)).toEqual(worldBefore)
    expect(await db.productReleases.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    expect(await db.productRuntimeSessions.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    if (['repair', 'repeat-error', 'refs-missing', 'refs-misplaced', 'refs-repeat-error', 'refs-private', 'refs-private-repeat'].includes(scenario)) {
      const beforeEvidence = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray())
        .filter(row => ['raw-response', 'tool-result'].includes(row.artifactKind))
        .map(row => [row.artifactKind, row.contentHash, row.content])
      const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
      expect(importedId).not.toBe(f.scope.projectId)
      db.close(); await db.open()
      const afterEvidence = (await db.agentRunArtifacts.where('projectId').equals(importedId).toArray())
        .filter(row => ['raw-response', 'tool-result'].includes(row.artifactKind))
        .map(row => [row.artifactKind, row.contentHash, row.content])
      expect(afterEvidence).toEqual(beforeEvidence)
      const restoredBuild = await db.productBuilds.where('projectId').equals(importedId).first()
      expect(JSON.parse(restoredBuild!.budgetLedgerJson).attempts.filter((row: {taskKey: string}) => row.taskKey === 'content.product-module'))
        .toMatchObject([{attempt: 1, outcome: 'failed', usageKnown: true}, {attempt: 2, outcome: passed ? 'settled' : 'failed', usageKnown: true}])
      expect(calls).toHaveLength(passed ? 3 : 2)
    }
  },
)
