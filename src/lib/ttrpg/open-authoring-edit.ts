/** Local author input only. Import does not inherit another file's human
 * confirmations, world authority, production start or model execution rights. */
import type { TtrpgOpenAuthoringV1 } from './open-contract'
import { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'

export const MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1 = 4 * 1024 * 1024

export function parseTtrpgOpenAuthoringEditV1(text: string): TtrpgOpenAuthoringV1 {
  if (new TextEncoder().encode(text).length > MAX_TTRPG_OPEN_AUTHORING_EDIT_BYTES_V1) throw new Error('开放设计不能超过 4 MB；原草稿保持不变')
  const value = parseTtrpgOpenAuthoringV1(JSON.parse(text))
  return { ...value, factPolicy: value.factPolicy.map(item => ({ ...item, authorConfirmed: false })) }
}

export function reviewTtrpgOpenAuthoringEditV1(candidate: TtrpgOpenAuthoringV1, confirmedFactKeys: readonly string[]): TtrpgOpenAuthoringV1 {
  const value = parseTtrpgOpenAuthoringV1(candidate), known = new Set(value.factPolicy.map(item => item.fact.factKey))
  if (new Set(confirmedFactKeys).size !== confirmedFactKeys.length || confirmedFactKeys.some(key => !known.has(key))) throw new Error('事实确认与当前设计不一致，请重新核对')
  const confirmed = new Set(confirmedFactKeys)
  return { ...value, factPolicy: value.factPolicy.map(item => ({ ...item, authorConfirmed: confirmed.has(item.fact.factKey) })) }
}

/** Editable safety/budget defaults, never a complete scenario or start grant. */
export function initializeTtrpgOpenAuthoringPoliciesV1(input: TtrpgOpenAuthoringV1): TtrpgOpenAuthoringV1 {
  const value = parseTtrpgOpenAuthoringV1(input)
  return { ...value,
    companionPolicy: value.companionPolicy ?? { minimumCompanions: 2, maximumCompanions: 3, preauthorizedActionKinds: [],
      confirmationRequiredKinds: ['irreversible', 'resource-spend', 'party-relation-change', 'secret-reveal'], approvalBindings: [] },
    stageClosurePolicy: value.stageClosurePolicy ?? { maximumWorldTurns: 50, continuation: 'author-confirmed-opening',
      triggers: [{ triggerKey: 'stage.author-limit', predicate: { op: 'world-turn-at-least', value: 50 }, summaryPrompt: '总结本阶段已发生的事实和未解决事项，等待作者确认下一阶段开场。' }] },
    runtimePolicy: value.runtimePolicy ?? { enabled: false, maximumCallsPerEpoch: 6, maxAiActions: 0, maximumOutputTokens: 2000,
      maximumEpochTokens: 16000, maximumEpochCostUsd: 1, maximumRepairAttempts: 0, failurePolicy: 'pause', unknownResultPolicy: 'pause-and-reconcile', outputMode: 'text' },
  }
}
