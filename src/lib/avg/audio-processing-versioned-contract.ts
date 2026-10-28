import { avgProtocolBody } from './protocol-validation'
import { parseAvgAudioProcessingRecipeV1, parseAvgAudioProcessingReceiptV1, assertAvgAudioProcessingReceiptV1,
  type AvgAudioProcessingRecipeV1, type AvgAudioProcessingReceiptV1 } from './audio-processing-contract'
import { parseAvgAudioProcessingRecipeV2, parseAvgAudioProcessingReceiptV2, assertAvgAudioProcessingReceiptV2,
  type AvgAudioProcessingRecipeV2, type AvgAudioProcessingReceiptV2 } from './audio-processing-contract-v2'

export type AvgAudioProcessingRecipe = AvgAudioProcessingRecipeV1 | AvgAudioProcessingRecipeV2
export type AvgAudioProcessingReceipt = AvgAudioProcessingReceiptV1 | AvgAudioProcessingReceiptV2
export function parseAvgAudioProcessingRecipe(value: unknown): AvgAudioProcessingRecipe {
  const body = avgProtocolBody(value)
  return (body as { version?: unknown } | null)?.version === 2 ? parseAvgAudioProcessingRecipeV2(body) : parseAvgAudioProcessingRecipeV1(body)
}
export function parseAvgAudioProcessingReceipt(value: unknown): AvgAudioProcessingReceipt {
  const body = avgProtocolBody(value)
  return (body as { version?: unknown } | null)?.version === 2 ? parseAvgAudioProcessingReceiptV2(body) : parseAvgAudioProcessingReceiptV1(body)
}
export function assertAvgAudioProcessingReceipt(recipeInput: AvgAudioProcessingRecipe, value: unknown) {
  const recipe = parseAvgAudioProcessingRecipe(recipeInput), receipt = parseAvgAudioProcessingReceipt(value)
  if (recipe.version === 2 && receipt.version === 2) return assertAvgAudioProcessingReceiptV2(recipe, receipt)
  if (recipe.version === 1 && receipt.version === 1) return assertAvgAudioProcessingReceiptV1(recipe, receipt)
  throw new Error('[avg-audio-process] 配方与回执必须属于同一明确版本')
}
