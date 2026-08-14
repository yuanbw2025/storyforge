import type { EvalSplit } from './types'
import {
  exportH4SubtypeAdjudicationCheckpointV1,
  importH4SubtypeAdjudicationCheckpointV1,
  type H4SubtypeAdjudicationCheckpointV1,
} from './h4-adjudication'
import {
  scoreH4SubtypeAdjudicationCheckpointV1,
  type H4SubtypeAdjudicationSealedScoreV1,
} from './h4-adjudication-scoring'

export const H4_SUBTYPE_ADJUDICATION_BROWSER_STORAGE_PREFIX_V1 =
  'storyforge-h4-subtype-adjudication-checkpoint-v1'

export interface H4SubtypeAdjudicationBrowserStateV1 {
  checkpoint: H4SubtypeAdjudicationCheckpointV1
  score: H4SubtypeAdjudicationSealedScoreV1
}

type CheckpointStorageV1 = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function h4SubtypeAdjudicationBrowserStorageKeyV1(split: EvalSplit): string {
  return `${H4_SUBTYPE_ADJUDICATION_BROWSER_STORAGE_PREFIX_V1}:${split}`
}

function resolveStorage(storage?: CheckpointStorageV1): CheckpointStorageV1 {
  if (storage) return storage
  if (typeof localStorage === 'undefined') throw new Error('当前环境不支持 H85 浏览器 checkpoint')
  return localStorage
}

export async function loadH4SubtypeAdjudicationBrowserStateV1(
  split: EvalSplit,
  storage?: CheckpointStorageV1,
): Promise<H4SubtypeAdjudicationBrowserStateV1 | null> {
  const raw = resolveStorage(storage).getItem(h4SubtypeAdjudicationBrowserStorageKeyV1(split))
  if (raw == null) return null
  const checkpoint = await importH4SubtypeAdjudicationCheckpointV1(raw)
  if (checkpoint.split !== split) throw new Error(`H85 ${split} 存储槽包含错误 split`)
  return {
    checkpoint,
    score: await scoreH4SubtypeAdjudicationCheckpointV1({ checkpoint }),
  }
}

export async function persistH4SubtypeAdjudicationBrowserCheckpointV1(
  checkpoint: H4SubtypeAdjudicationCheckpointV1,
  storage?: CheckpointStorageV1,
): Promise<void> {
  const raw = await exportH4SubtypeAdjudicationCheckpointV1(checkpoint)
  resolveStorage(storage).setItem(
    h4SubtypeAdjudicationBrowserStorageKeyV1(checkpoint.split),
    raw,
  )
}

export function clearH4SubtypeAdjudicationBrowserCheckpointV1(
  split: EvalSplit,
  storage?: CheckpointStorageV1,
): void {
  resolveStorage(storage).removeItem(h4SubtypeAdjudicationBrowserStorageKeyV1(split))
}
