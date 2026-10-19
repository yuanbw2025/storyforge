import type { AIConfig, ProviderCapabilityRequirementV1 } from '../types'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../ai/client'
import { resolveConfiguredAgnesImageCapabilityV1, configuredAgnesImageEndpointHashV1,
  resolveConfiguredAgnesImageCapabilityV2,configuredAgnesImageEndpointHashV2 } from '../product-production/media-transport'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { configuredAvgVoiceEndpointHashV1, createConfiguredAvgVoiceTransportV1, createConfiguredAvgLocalVoiceTransportV1 } from './voice-transport'
import { AVG_LOCAL_VOICE_PROVIDER_V1 } from './voice-local-profile'
import type { AvgAssemblyBriefV3 } from './voice-assembly-contract'
import type { AvgAssemblyBriefV2 } from './assembly-contract'
import { avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from './media-reference-contract'

export async function avgImageRouteBindingHashV2(input: { requirementKey: string; adapterId: string; baseCapabilityHash: string; endpointRouteHash: string }) {
  return hashProductProductionValueV2({ schema: 'storyforge.avg.image-route-binding', version: 2, ...input })
}

/** Captures one private config snapshot. Only non-secret identity hashes leave
 * this resolver; no HTTP/model request or credential persistence occurs here. */
export async function resolveAvgImageExecutionCapabilityV2(input: {
  projectId: number; requirement: ProviderCapabilityRequirementV1; config?: AIConfig
}) {
  const config = structuredClone(input.config ?? resolveRequestConfig(useAIConfigStore.getState().config, {
    category: 'product-production', projectId: input.projectId,
  }).config)
  const resolved = await resolveConfiguredAgnesImageCapabilityV1({ ...input, config })
  const adapterId = resolved.binding.adapterId
  if (adapterId !== 'agnes.image-2.1-flash.v1') throw new Error('[avg-media] 图片能力不属于当前 AVG 登记的生成适配器')
  const endpointRouteHash = await configuredAgnesImageEndpointHashV1({ projectId: input.projectId, config })
  const binding: Omit<AvgAssemblyBriefV2['imageBinding'], 'endpointRouteHash'> = {
    ...resolved.binding, adapterId, bindingHash: await avgImageRouteBindingHashV2({ requirementKey: input.requirement.requirementKey,
      adapterId, baseCapabilityHash: resolved.binding.bindingHash, endpointRouteHash }),
  }
  return { resolved, binding, endpointRouteHash }
}

/** V4 selects a model explicitly. Existing V2/V3 resolvers remain exactly 2.1;
 * changing the configured text model cannot change a frozen image request. */
export async function resolveAvgImageExecutionCapabilityV4(input:{projectId:number;requirement:ProviderCapabilityRequirementV1;adapterId:AvgImageAdapterIdV4;config?:AIConfig}){
  const capability=avgImageReferenceCapabilityV2(input.adapterId)
  if(input.requirement.capabilityHash!==await hashProductProductionValueV2(capability))throw new Error('[avg-visual-image] 图片模型与冻结输入能力不一致')
  if(input.adapterId==='agnes.image-2.1-flash.v1')return resolveAvgImageExecutionCapabilityV2(input)
  const config=structuredClone(input.config??resolveRequestConfig(useAIConfigStore.getState().config,{category:'product-production',projectId:input.projectId}).config)
  const resolved=await resolveConfiguredAgnesImageCapabilityV2({...input,config})
  if(resolved.binding.adapterId!==input.adapterId)throw new Error('[avg-visual-image] 图片模型与实际绑定不一致')
  const endpointRouteHash=await configuredAgnesImageEndpointHashV2({projectId:input.projectId,config})
  const binding={...resolved.binding,adapterId:input.adapterId,bindingHash:await avgImageRouteBindingHashV2({requirementKey:input.requirement.requirementKey,
    adapterId:input.adapterId,baseCapabilityHash:resolved.binding.bindingHash,endpointRouteHash})}
  return {resolved,binding,endpointRouteHash}
}

/** Reuses only the explicitly selected current route/credential snapshot.
 * The frozen speech protocol supplies its own exact model/voice, never an
 * image/text default. This performs no request or account-capability claim. */
export async function resolveAvgVoiceExecutionCapabilityV3(input: {
  projectId: number; assembly: AvgAssemblyBriefV3; capability: ProviderCapabilityRequirementV1; config?: AIConfig
}) {
  if (input.assembly.voice.protocol.provider === AVG_LOCAL_VOICE_PROVIDER_V1) {
    return createConfiguredAvgLocalVoiceTransportV1({ assembly: input.assembly, capability: input.capability })
  }
  const config = structuredClone(input.config ?? resolveRequestConfig(useAIConfigStore.getState().config, {
    category: 'product-production', projectId: input.projectId,
  }).config)
  return createConfiguredAvgVoiceTransportV1({ config, assembly: input.assembly, capability: input.capability })
}

/** Inert editor identity only. Does not return a credential, make a request,
 * discover account capabilities, or grant start/adoption authority. */
export async function readConfiguredAvgVoiceDraftRouteV1(input: { projectId: number; model: string }) {
  const config = resolveRequestConfig(useAIConfigStore.getState().config, {
    category: 'product-production', projectId: input.projectId,
  }).config
  if (config.provider !== 'agnes') throw new Error('[avg-voice] 请先在现有模型设置中明确选择 Agnes；配音草稿不会替换全局路由')
  return { endpointRouteHash: await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: input.model }) }
}
