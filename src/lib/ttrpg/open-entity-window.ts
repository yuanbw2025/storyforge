/** Pure pending-plan guard. Coordination must not eagerly import replay journals or live/model preflight. */
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { fail } from './open-contract-parse'
export function assertTtrpgOpenEntityWindowEventV1(runtime: Pick<TtrpgRuntimeStateV2, 'openRun'> | null, type: string) {
  if (!runtime?.openRun?.entityOperations?.some(row => !row.resolution)) return
  if (!['ttrpg.open.entity.confirmed', 'ttrpg.open.entity.materialized', 'ttrpg.open.entity.disposed',
    'ttrpg.safety.changed', 'ttrpg.audio.voice.cancelled', 'ttrpg.open.table-message.posted', 'ttrpg.open.failure.logged'].includes(type)) fail('请先确认或放弃当前实体计划；不能并行改变原机械状态或离开授权窗口')
}
