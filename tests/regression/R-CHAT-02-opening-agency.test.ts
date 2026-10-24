import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import * as runs from '../../src/lib/agent/run/event-store'
import {chatSituationProductionPromptV1} from '../../src/lib/character-interaction/narrative-production'
import {CHAT_OPENING_AGENCY_GATE_V2} from '../../src/lib/character-interaction/opening-agency'
import {readChatOpeningProductionVersionV1} from '../../src/lib/character-interaction/opening-production-binding'
import {assertChatOpeningReviewedV1, chatOpeningReviewPromptV1, createChatOpeningReviewV1, parseChatOpeningReviewDraftV1} from '../../src/lib/character-interaction/situation-production-review'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {selectedChatProductionNarrativeV1} from '../../src/lib/product-production/chat-situation-tasks'
import type {ProductProductionTaskExecutionInputV1} from '../../src/lib/product-production/scheduler'
import {chatOpeningAgencyReviewFixture, chatOpeningReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {buildChatOpeningFactCatalogV2, parseChatOpeningSourceBoundOutputV2} from '../../src/lib/character-interaction/opening-source-references'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('keeps independently captured pre-V115 prompt bytes and selects new opportunity rules explicitly', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex')
  // Captured from clean 632bdc3b in a separate archived checkout before edits.
  expect(hash(chatSituationProductionPromptV1(true))).toBe('4d32f6eec104de2aee609f76a5be02f934993bd37f178de3fe93f68943588da5')
  expect(hash(chatSituationProductionPromptV1(false))).toBe('8fbf9070e610f26a9a2e926bd28d6b071c1f439ba7ed2ae5fffcdedd63b177c1')
  expect(hash(chatOpeningReviewPromptV1())).toBe('2dde131ecacfb9a1c81c60df7a0c60dd5c4bc90eb366a1e941cb00d751ef2a8f')
  expect(chatSituationProductionPromptV1(true, true)).toContain('人物存在不等于在场')
  expect(chatOpeningReviewPromptV1(2)).toContain('系统校验身份、引用和知情范围，你仍须独立判断')
  expect(chatOpeningReviewPromptV1(2)).toContain('不得要求穷尽想象中的所有办法')
})

it.each(['act', 'wait'] as const)('retains a grounded %s claim without turning expected or unresolved outcomes into facts', async mode => {
  const f = await seedChatNarrativeProductionFixture(), before = structuredClone(f.candidates)
  const draft = chatOpeningAgencyReviewFixture(f.candidates)
  draft.options[0].agency!.mode = mode
  if (mode === 'wait') {
    draft.options[0].agency!.expectedChange = '在现有休息需要下先陪伴，稍后是否恢复仍由双方决定。'
    draft.options[0].agency!.unresolved = '等待不代表维修已完成，也不保证稍后有人帮忙。'
  }
  const report = await createChatOpeningReviewV1(draft, f.source, f.candidates, 2)
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-1', 2)).resolves.toEqual(report)
  expect(f.candidates).toEqual(before)
  expect(report.options[0].agency).toEqual(draft.options[0].agency)
  expect(report.options[0].agency).not.toBe(draft.options[0].agency)
  // The injected semantic pass only exercises storage; it is not a quality verdict.
})

it.each(['missing agency', 'unknown actor', 'wrong goal owner', 'unknown goal', 'other actor direction', 'unknown direction', 'fractional direction', 'negative direction', 'hidden basis', 'unreferenced basis', 'unknown basis', 'duplicate basis', 'missing direction quote', 'missing fact quote', 'invented quote', 'empty change', 'empty unknown', 'extra field', 'invalid mode'] as const)('rejects unsupported opportunity evidence: %s', async invalid => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true, privateCast: 'mixed'})
  const draft = chatOpeningAgencyReviewFixture(f.candidates), row = draft.options[0], agency = row.agency!
  const viable = row.checks.find(c => c.check === 'viable-agency')!
  if (invalid === 'missing agency') row.agency = null
  if (invalid === 'unknown actor') agency.actorKey = 'unknown'
  if (invalid === 'wrong goal owner') agency.goalKey = f.candidates.options[0].situation.goals[1].goalKey
  if (invalid === 'unknown goal') agency.goalKey = 'missing'
  if (invalid === 'other actor direction') {
    agency.actorKey = f.candidates.options[0].situation.goals[1].actorKey
    agency.goalKey = f.candidates.options[0].situation.goals[1].goalKey
  }
  if (invalid === 'unknown direction') agency.possibilityIndex = 99
  if (invalid === 'fractional direction') agency.possibilityIndex = 0.1
  if (invalid === 'negative direction') agency.possibilityIndex = -1
  if (invalid === 'hidden basis') agency.basisFactKeys = ['hidden-note']
  if (invalid === 'unreferenced basis') agency.basisFactKeys = ['parcel']
  if (invalid === 'unknown basis') agency.basisFactKeys = ['nonexistent']
  if (invalid === 'duplicate basis') agency.basisFactKeys.push(agency.basisFactKeys[0])
  if (invalid === 'missing direction quote') viable.evidence.shift()
  if (invalid === 'missing fact quote') viable.evidence.pop()
  if (invalid === 'invented quote') viable.evidence[1].quote = '掌柜已经在场并愿意回答'
  if (invalid === 'empty change') agency.expectedChange = ' '
  if (invalid === 'empty unknown') agency.unresolved = ''
  if (invalid === 'extra field') Object.assign(agency, {grantedPermission: true})
  if (invalid === 'invalid mode') agency.mode = 'force-success' as never
  expect(() => parseChatOpeningReviewDraftV1(draft, f.source, f.candidates, 2)).toThrow()
})

it('preserves a semantic rejection with no claimed opportunity and prevents its selection', async () => {
  const f = await seedChatNarrativeProductionFixture(), draft = chatOpeningAgencyReviewFixture(f.candidates, 'option-1')
  const report = await createChatOpeningReviewV1(draft, f.source, f.candidates, 2)
  expect(report.options[0].agency).toBeNull()
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-1', 2)).rejects.toThrow('未通过')
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-2', 2)).resolves.toEqual(report)
})

it.each(['content.chat-author-gate', 'content.narrative', 'integration.package'])('does not let legacy reports or absent dependencies satisfy the new %s contract', async taskKey => {
  const f = await seedChatNarrativeProductionFixture(), plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashProductProductionValueV2(f.brief), buildNumber: 1})
  f.candidates = await parseChatOpeningSourceBoundOutputV2(f.candidates, f.source, await buildChatOpeningFactCatalogV2(f.source))
  const task = plan.tasks.find(t => t.taskKey === taskKey)!
  expect(task.acceptanceGateIds).toContain(CHAT_OPENING_AGENCY_GATE_V2)
  const report = await createChatOpeningReviewV1(chatOpeningReviewFixture(f.candidates), f.source, f.candidates)
  const selection = {schema: 'storyforge.chat-situation-selection', version: 1, sourceHash: report.sourceHash, candidatesHash: report.candidatesHash, selectedOptionKey: 'option-1', authorCommandId: 'author.choose'}
  const input = {task, inputArtifacts: Object.entries({'design.game': f.source, 'content.chat-candidates': f.candidates, 'quality.chat-openings': report, 'content.chat-selection': selection}).map(([artifactKey, value]) => ({artifactKey, payloadJson: JSON.stringify(value)}))} as unknown as ProductProductionTaskExecutionInputV1
  await expect(selectedChatProductionNarrativeV1(input)).rejects.toThrow('旧报告保持原样')
  await expect(selectedChatProductionNarrativeV1({...input, task: {...task, inputArtifactKeys: task.inputArtifactKeys.filter(k => k !== 'quality.chat-openings')}})).rejects.toThrow('缺少开场审查依赖')
  await expect(selectedChatProductionNarrativeV1({...input, task: {...task, acceptanceGateIds: task.acceptanceGateIds.filter(g => g !== CHAT_OPENING_AGENCY_GATE_V2 && g !== 'chat.opening-development.v3')}})).resolves.toMatchObject({initialSituation: f.candidates.options[0].situation})
})

it('reads saved production/review bindings; rejects missing, foreign, unsupported or falsely upgraded contracts', async () => {
  const f = await seedChatNarrativeProductionFixture(), plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashProductProductionValueV2(f.brief), buildNumber: 1})
  for (const [taskKey, oldVersion, newVersion] of [['content.product-module', 'chat-situation-production-v5', 'chat-situation-production-v6'], ['content.chat-opening-review', 'chat-opening-review-v1', 'chat-opening-review-v2']]) {
    const planned = plan.tasks.find(t => t.taskKey === taskKey)!
    const originalTask = {...planned, acceptanceGateIds: planned.acceptanceGateIds.filter(g => g !== 'chat.opening-development.v3')}
    const input = {scope: f.scope, buildId: 7, buildNumber: 2, controlEpoch: 3, planHash: 'a'.repeat(64), taskRunId: 1,
      task: {...originalTask, acceptanceGateIds: originalTask.acceptanceGateIds.filter(id => !id.startsWith('chat.opening-targeted-repair.') && id !== 'chat.opening-source-references.v1' && id !== 'chat.opening-option-repair.v1' && id !== 'chat.opening-source-completeness.v1')}} as ProductProductionTaskExecutionInputV1
    const scope = {productBuildId: input.buildId, buildNumber: input.buildNumber, controlEpoch: input.controlEpoch, planHash: input.planHash, taskKey}
    const snapshot = {contract: {scope: {productProduction: scope}, executionBindings: [{stepId: taskKey, skillId: input.task.skillId, promptVersion: newVersion}]}} as runs.AgentRunSnapshotV1
    const read = vi.spyOn(runs, 'readAgentRunV1').mockResolvedValue(snapshot)
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual({groundedAgency: true})
    const binding = snapshot.contract.executionBindings![0]
    if (taskKey === 'content.product-module') {
      binding.promptVersion = 'chat-situation-production-v7'
      const v8Task = {...originalTask, acceptanceGateIds: originalTask.acceptanceGateIds.filter(id => id !== 'chat.opening-source-references.v1' && id !== 'chat.opening-option-repair.v1' && id !== 'chat.opening-source-completeness.v1')}
      const v7Task = {...v8Task, acceptanceGateIds: v8Task.acceptanceGateIds.map(id => id === 'chat.opening-targeted-repair.v2' ? 'chat.opening-targeted-repair.v1' : id)}
      await expect(readChatOpeningProductionVersionV1({...input, task: v7Task})).resolves.toEqual({groundedAgency: true, targetedRepair: true})
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).rejects.toThrow('不能自动换约')
      binding.promptVersion = 'chat-situation-production-v8'
      await expect(readChatOpeningProductionVersionV1({...input, task: v8Task})).resolves.toEqual({groundedAgency: true, targetedRepair: true, patchRepair: true})
      await expect(readChatOpeningProductionVersionV1({...input, task: v7Task})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).rejects.toThrow('不能自动换约')
      const v9Task = {...originalTask, acceptanceGateIds: originalTask.acceptanceGateIds.filter(id => id !== 'chat.opening-option-repair.v1' && id !== 'chat.opening-source-completeness.v1')}
      binding.promptVersion = 'chat-situation-production-v9'
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: v9Task})).resolves.toEqual({groundedAgency: true, targetedRepair: true, patchRepair: true, sourceReferences: true})
      await expect(readChatOpeningProductionVersionV1({...input, task: v8Task})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: {...originalTask, inputArtifactKeys: ['design.game']}})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1(input)).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: {...originalTask, budgetReservation: {...originalTask.budgetReservation, modelCalls: 1}}})).rejects.toThrow('不能自动换约')
      const v10Task = {...originalTask, acceptanceGateIds: originalTask.acceptanceGateIds.filter(id => id !== 'chat.opening-source-completeness.v1')}
      binding.promptVersion = 'chat-situation-production-v10'
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: v10Task})).resolves.toEqual({groundedAgency: true, targetedRepair: true, patchRepair: true, sourceReferences: true, optionRepair: true})
      await expect(readChatOpeningProductionVersionV1({...input, task: v9Task})).rejects.toThrow('不能自动换约')
      await expect(readChatOpeningProductionVersionV1({...input, task: {...originalTask, inputArtifactKeys: ['design.game']}})).rejects.toThrow('不能自动换约')
      binding.promptVersion = 'chat-situation-production-v11'
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).resolves.toEqual({groundedAgency: true, targetedRepair: true, patchRepair: true, sourceReferences: true, optionRepair: true, completeSourceFacts: true})
      await expect(readChatOpeningProductionVersionV1({...input, task: v10Task})).rejects.toThrow('不能自动换约')
      binding.promptVersion = newVersion
      await expect(readChatOpeningProductionVersionV1({...input, task: originalTask})).rejects.toThrow('不能自动换约')
    }
    binding.promptVersion = oldVersion
    await expect(readChatOpeningProductionVersionV1(input)).rejects.toThrow('不能自动换约')
    const legacy = {...input, task: {...input.task, acceptanceGateIds: input.task.acceptanceGateIds.filter(g => g !== CHAT_OPENING_AGENCY_GATE_V2 && g !== 'chat.opening-development.v3')}}
    await expect(readChatOpeningProductionVersionV1(legacy)).resolves.toEqual({groundedAgency: false})
    for (const unsupported of ['future-v999', 'chat-situation-production-v4']) {
      binding.promptVersion = unsupported
      await expect(readChatOpeningProductionVersionV1(legacy)).rejects.toThrow('未支持')
    }
    binding.promptVersion = newVersion
    for (const key of ['buildId', 'buildNumber', 'controlEpoch'] as const) await expect(readChatOpeningProductionVersionV1({...input, [key]: input[key] + 1})).rejects.toThrow('不属于本次任务')
    await expect(readChatOpeningProductionVersionV1({...input, planHash: 'b'.repeat(64)})).rejects.toThrow('不属于本次任务')
    await expect(readChatOpeningProductionVersionV1({...input, taskRunId: undefined})).rejects.toThrow('缺少冻结任务运行')
    snapshot.contract.executionBindings = []
    await expect(readChatOpeningProductionVersionV1(input)).rejects.toThrow('不属于本次任务')
    read.mockRestore()
  }
})
