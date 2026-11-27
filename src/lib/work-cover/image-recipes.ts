import { hashCanonicalValue } from '../agent/run/hash'
import type { AIConfig } from '../types'
import { aiCredentialFingerprintV1 } from '../ai/credential-fingerprint'
import { AI_PROXY_ENDPOINTS, hasLocalProviderProxy } from '../ai/proxy-endpoints'

export const WORK_COVER_IMAGE_ADAPTER_V1 = 'agnes-images-b64-sync-v1'
export const WORK_COVER_IMAGE_RECIPES_V1 = [{
  recipeId: 'agnes-image-2.1-b64-v1', models: ['agnes-image-2.1-flash'],
  parameters: { size: '1K', ratio: '2:3', return_base64: true },
  maximumPromptChars: 16_000, response: 'data[0].b64_json', requestLookup: false,
  protocolSource: 'https://wiki.agnes-ai.com/en/docs/agnes-image-21-flash.md',
}] as const

export interface WorkCoverImageRouteV1 {
  adapterId: typeof WORK_COVER_IMAGE_ADAPTER_V1
  connectionPresetId: string
  imageModel: string
  endpoint: string
  recipeId: string
  protocolVersion: 1
  capabilityManifestHash: string
  credentialIdentity: string
  routeHash: string
}

export function workCoverRecipeV1(model: string) {
  const recipe = WORK_COVER_IMAGE_RECIPES_V1.find(item => (item.models as readonly string[]).includes(model))
  if (!recipe) throw new Error('尚未登记这个图片型号的同步配方，请在设置中选择支持的图片连接。')
  return recipe
}

export function workCoverAgnesBaseV1(config: Pick<AIConfig, 'provider' | 'baseUrl'>): string {
  if (config.provider !== 'agnes') throw new Error('此连接尚未登记封面图片协议，请选择 Agnes 图片连接。')
  // This exact local alias is already registered in Vite/portable proxy and
  // credential authority. No arbitrary relative route or provider alias is accepted.
  const direct = config.baseUrl === AI_PROXY_ENDPOINTS.agnes!.proxy ? AI_PROXY_ENDPOINTS.agnes!.direct : config.baseUrl
  let base: URL
  try { base = new URL(direct) } catch { throw new Error('图片连接地址无效。') }
  if (/[?#]/.test(direct) || base.username || base.password || base.hash || base.search || base.protocol !== 'https:'
    || base.hostname !== 'apihub.agnes-ai.com' || base.port || base.pathname.replace(/\/$/, '') !== '/v1') throw new Error('封面图片只接受已登记的 Agnes 官方连接。')
  return 'https://apihub.agnes-ai.com/v1'
}

export async function resolveWorkCoverImageRouteV1(input: { config: AIConfig; presetId: string; imageModel: string }): Promise<WorkCoverImageRouteV1> {
  const base = workCoverAgnesBaseV1(input.config), recipe = workCoverRecipeV1(input.imageModel)
  if (!input.presetId.trim()) throw new Error('请明确选择图片连接预设。')
  const native = typeof window !== 'undefined' && Boolean(window.storyforgeClient?.http)
  const endpoint = !native && hasLocalProviderProxy() && input.config.baseUrl === AI_PROXY_ENDPOINTS.agnes!.proxy
    ? `${AI_PROXY_ENDPOINTS.agnes!.proxy}/images/generations` : `${base}/images/generations`
  const body: Omit<WorkCoverImageRouteV1, 'routeHash'> = {
    adapterId: WORK_COVER_IMAGE_ADAPTER_V1, connectionPresetId: input.presetId, imageModel: input.imageModel,
    endpoint, recipeId: recipe.recipeId, protocolVersion: 1,
    capabilityManifestHash: await hashCanonicalValue(recipe), credentialIdentity: await aiCredentialFingerprintV1(input.config),
  }
  return { ...body, routeHash: await hashCanonicalValue(body) }
}

export function buildCoverImageRequestV1(route: WorkCoverImageRouteV1, prompt: string) {
  const recipe = workCoverRecipeV1(route.imageModel)
  if (!prompt.trim() || prompt.length > recipe.maximumPromptChars || route.recipeId !== recipe.recipeId) throw new Error('图片提示词超过当前协议上限或配方已变化，请修改后重新生成。')
  return { model: route.imageModel, prompt, ...recipe.parameters }
}
