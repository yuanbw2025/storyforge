import type { EvalSplit } from './types'
import {
  exportH4LongConsistencyRunCheckpointV1,
  importH4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
} from './h4-runner'
import {
  scoreH4LongConsistencyCheckpointV1,
  type H4LongConsistencySealedScoreV1,
} from './h4-scoring'

export const H4_LONG_CONSISTENCY_BROWSER_STORAGE_PREFIX_V1 =
  'storyforge-h4-long-consistency-checkpoint-v1'

export interface H4LongConsistencyBrowserStateV1 {
  checkpoint: H4LongConsistencyRunCheckpointV1
  score: H4LongConsistencySealedScoreV1
}

type CheckpointStorageV1 = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function h4LongConsistencyBrowserStorageKeyV1(split: EvalSplit): string {
  return `${H4_LONG_CONSISTENCY_BROWSER_STORAGE_PREFIX_V1}:${split}`
}

function resolveStorage(storage?: CheckpointStorageV1): CheckpointStorageV1 {
  if (storage) return storage
  if (typeof localStorage === 'undefined') throw new Error('当前环境不支持 H4 浏览器 checkpoint')
  return localStorage
}

export async function loadH4LongConsistencyBrowserStateV1(
  split: EvalSplit,
  storage?: CheckpointStorageV1,
): Promise<H4LongConsistencyBrowserStateV1 | null> {
  const raw = resolveStorage(storage).getItem(h4LongConsistencyBrowserStorageKeyV1(split))
  if (raw == null) return null
  const checkpoint = await importH4LongConsistencyRunCheckpointV1(raw)
  if (checkpoint.split !== split) throw new Error(`H4 ${split} 存储槽包含错误 split`)
  return {
    checkpoint,
    score: await scoreH4LongConsistencyCheckpointV1({ checkpoint }),
  }
}

export async function persistH4LongConsistencyBrowserCheckpointV1(
  checkpoint: H4LongConsistencyRunCheckpointV1,
  storage?: CheckpointStorageV1,
): Promise<void> {
  const raw = await exportH4LongConsistencyRunCheckpointV1(checkpoint)
  resolveStorage(storage).setItem(
    h4LongConsistencyBrowserStorageKeyV1(checkpoint.split),
    raw,
  )
}

export function clearH4LongConsistencyBrowserCheckpointV1(
  split: EvalSplit,
  storage?: CheckpointStorageV1,
): void {
  resolveStorage(storage).removeItem(h4LongConsistencyBrowserStorageKeyV1(split))
}
