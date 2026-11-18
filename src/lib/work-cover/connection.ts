import { getAIConfigPresetApiKeyV1, useAIConfigStore } from '../../stores/ai-config'
import { workCoverAgnesBaseV1 } from './image-recipes'
import type { CoverImageConnectionV1 } from './run'

/** Reuse only the selected preset's own paired credential. A writing model or
 * an unrelated current key never supplies the image model or permission. */
export function readWorkCoverConnectionV1(): CoverImageConnectionV1 {
  const state = useAIConfigStore.getState()
  const presetId = state.workCoverPresetId ?? state.activePresetId
  const preset = state.presets.find(item => item.id === presetId)
  if (!preset) throw new Error('请先在设置中选择一个图片连接预设。')
  workCoverAgnesBaseV1(preset.config)
  const apiKey = getAIConfigPresetApiKeyV1(preset)
  if (!apiKey.trim()) throw new Error('图片连接没有可用凭据，请在设置中重新填写。')
  return { presetId: preset.id, imageModel: 'agnes-image-2.1-flash', config: { ...preset.config, apiKey } }
}

export function workCoverConnectionLabelV1(): string {
  const connection = readWorkCoverConnectionV1()
  const name = useAIConfigStore.getState().presets.find(item => item.id === connection.presetId)?.name ?? '图片连接'
  return `${name} · ${connection.imageModel} · 单张，费用未知`
}
