import { db } from '../db/schema'
import { assertRecordInScope, resolveScopeLike } from '../workspace/scope'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { parseCharacterDrivenPlanArcs, stringifyCharacterDrivenPlanArcs } from '../types'
import type { CharacterDrivenPlan, CharacterDrivenPlanArc, WorkspaceScope } from '../types'

export interface CharacterDrivenInputSaveV1 { scope: WorkspaceScope; expected: CharacterDrivenPlan }
export function characterDrivenInputKeyV1(input: { arcs: CharacterDrivenPlanArc[]; userHint: string }) {
  return JSON.stringify({ arcs: parseCharacterDrivenPlanArcs(input.arcs), userHint: input.userHint })
}
export function characterDrivenPlanInputKeyV1(row: CharacterDrivenPlan) {
  return characterDrivenInputKeyV1({ arcs: parseCharacterDrivenPlanArcs(row.arcs), userHint: row.userHint })
}
export function characterDrivenPlanUidV1(row: CharacterDrivenPlan) { return Reflect.get(row, 'ragDocumentId') }
export async function assertCharacterDrivenInputSourceV1(row: CharacterDrivenPlan | undefined, scope: WorkspaceScope) {
  if (!row?.id || !isPortableResourceUidV1(characterDrivenPlanUidV1(row), 'character-driven-plan')
    || !await assertRecordInScope(scope, 'characterDrivenPlans', row, { owner: 'work' })) throw new Error('原角色驱动方案身份或作品归属已变化，输入已保留。')
  if (typeof row.userHint !== 'string') throw new Error('方案作者要求格式异常，原数据已保留。')
  parseCharacterDrivenPlanArcs(row.arcs)
  return row
}
export async function readCharacterDrivenInputSourceV1(id: number, scope: WorkspaceScope) {
  const selected = await resolveScopeLike({ ...scope })
  return assertCharacterDrivenInputSourceV1(await db.characterDrivenPlans.get(id), selected)
}
export function assertCharacterDrivenInputExpectedV1(row: CharacterDrivenPlan, expected: CharacterDrivenPlan) {
  if (row.id !== expected.id || characterDrivenPlanUidV1(row) !== characterDrivenPlanUidV1(expected)
    || row.createdAt !== expected.createdAt || row.version !== expected.version || row.parentPlanId !== expected.parentPlanId
    || row.arcs !== expected.arcs || row.userHint !== expected.userHint) throw new Error('方案输入已被其他页面修改，当前草稿已保留，请核对原方案。')
}
export function assertCharacterDrivenInputWrittenV1(row: CharacterDrivenPlan, original: CharacterDrivenPlan, arcs: CharacterDrivenPlanArc[], userHint: string) {
  if (row.id !== original.id || characterDrivenPlanUidV1(row) !== characterDrivenPlanUidV1(original)
    || row.createdAt !== original.createdAt || row.version !== original.version || row.parentPlanId !== original.parentPlanId
    || row.arcs !== stringifyCharacterDrivenPlanArcs(arcs) || row.userHint !== userHint || row.status !== 'draft'
    || row.generatedVolumes !== original.generatedVolumes) throw new Error('未读到相同方案身份与输入原文，当前草稿已保留。')
}
