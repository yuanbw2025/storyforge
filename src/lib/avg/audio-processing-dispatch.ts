import { processAvgAudioPcmWaveV1, processAvgAudioPcmWaveWithWorkerV1, assertAvgAudioProcessingWaveBytesV1,
  type AvgAudioPcmWaveProcessingInputV1 } from './audio-processing'
import { processAvgAudioPcmWaveV2, processAvgAudioPcmWaveWithWorkerV2, assertAvgAudioProcessingWaveBytesV2 } from './audio-processing-v2'
import { parseAvgAudioProcessingRecipe, parseAvgAudioProcessingReceipt,
  type AvgAudioProcessingRecipe, type AvgAudioProcessingReceipt } from './audio-processing-versioned-contract'

export type AvgAudioPcmWaveProcessingInput = Omit<AvgAudioPcmWaveProcessingInputV1, 'recipe'> & { recipe: AvgAudioProcessingRecipe }
export function processAvgAudioPcmWave(input: AvgAudioPcmWaveProcessingInput) {
  const recipe = parseAvgAudioProcessingRecipe(input.recipe)
  return recipe.version === 2 ? processAvgAudioPcmWaveV2({ ...input, recipe }) : processAvgAudioPcmWaveV1({ ...input, recipe })
}
export function processAvgAudioPcmWaveWithWorker(input: AvgAudioPcmWaveProcessingInput) {
  const recipe = parseAvgAudioProcessingRecipe(input.recipe)
  return recipe.version === 2 ? processAvgAudioPcmWaveWithWorkerV2({ ...input, recipe }) : processAvgAudioPcmWaveWithWorkerV1({ ...input, recipe })
}
export function assertAvgAudioProcessingWaveBytes(input: { source: ArrayBuffer; output: ArrayBuffer;
  recipe: AvgAudioProcessingRecipe; receipt: AvgAudioProcessingReceipt; signal?: AbortSignal }) {
  const recipe = parseAvgAudioProcessingRecipe(input.recipe), receipt = parseAvgAudioProcessingReceipt(input.receipt)
  if (recipe.version === 2 && receipt.version === 2) return assertAvgAudioProcessingWaveBytesV2({ ...input, recipe, receipt })
  if (recipe.version === 1 && receipt.version === 1) return assertAvgAudioProcessingWaveBytesV1({ ...input, recipe, receipt })
  throw new Error('[avg-audio-process] 实际音频验证不能混用配方和回执版本')
}
