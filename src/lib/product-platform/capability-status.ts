export const PRODUCT_PLATFORM_ROLLOUT_STAGES_V1 = [
  'disabled',
  'developer',
  'experimental-project',
  'author-opt-in',
  'default',
] as const

export type ProductPlatformRolloutStageV1 = typeof PRODUCT_PLATFORM_ROLLOUT_STAGES_V1[number]
export type ProductPlatformEnvironmentV1 = 'test' | 'development' | 'preview' | 'production'
export type ProductPlatformEvidenceStatusV1 = 'proved' | 'partial' | 'pending'

export type ProductPlatformCapabilityIdV1 =
  | 'product-world-source-bundle'
  | 'product-production-v3'
  | 'ttrpg-formal-local'
  | 'ttrpg-ai-gm'
  | 'online-authoritative-room'
  | 'release-catalog'
  | 'commerce-payments'

export interface ProductPlatformCapabilityStatusV1 {
  id: ProductPlatformCapabilityIdV1
  rollout: ProductPlatformRolloutStageV1
  evidence: ProductPlatformEvidenceStatusV1
  userLabel: string
  reason: string
  requiresOnlineService: boolean
  requiresAiGmBetaGate: boolean
  allowedEnvironments: ProductPlatformEnvironmentV1[]
}

export interface ProductPlatformCapabilityContextV1 {
  environment: ProductPlatformEnvironmentV1
  experimentalProject: boolean
  authorOptIn: boolean
  onlineServiceConfigured: boolean
  aiGmBetaGatePassed: boolean
}

export interface ProductPlatformCapabilityDecisionV1 {
  enabled: boolean
  capability: ProductPlatformCapabilityStatusV1
  blockers: string[]
}

export {
  TTRPG_COMPLETION_REQUIRED_EVIDENCE_V2,
  validateTtrpgCompletionEvidenceV2,
} from './ttrpg-completion-evidence'
import { validateTtrpgCompletionEvidenceV2 } from './ttrpg-completion-evidence'

/** Replaced with a sealed generated attestation only after every completion gate passes. */
export const CURRENT_TTRPG_COMPLETION_ATTESTATION_V2: unknown = null
const TTRPG_COMPLETION_PROVED_V2 = validateTtrpgCompletionEvidenceV2(CURRENT_TTRPG_COMPLETION_ATTESTATION_V2)

export const PRODUCT_PLATFORM_CAPABILITIES_V1: readonly ProductPlatformCapabilityStatusV1[] = Object.freeze([
  {
    id: 'product-world-source-bundle', rollout: 'default', evidence: 'proved', userLabel: '世界游戏出口',
    reason: '不可变 WorldRelease 可编译为带来源证据的 ProductWorldSourceBundle。',
    requiresOnlineService: false, requiresAiGmBetaGate: false,
    allowedEnvironments: ['test', 'development', 'preview', 'production'],
  },
  {
    id: 'product-production-v3', rollout: 'author-opt-in', evidence: 'proved', userLabel: '自动游戏制作',
    reason: '五种已接入产品（跑团、角色互动、文字冒险、AVG、文字开放世界）均进入 Brief、Build、Preview、质量门与原子发布链；AI 小镇仍保持独立边界且尚未接入。TTRPG 使用九步 Brief、提案选择、验证后的 CampaignPack 与冻结 RulePack，不再依赖固定模板。',
    requiresOnlineService: false, requiresAiGmBetaGate: false,
    allowedEnvironments: ['test', 'development', 'preview', 'production'],
  },
  {
    id: 'ttrpg-formal-local',
    rollout: TTRPG_COMPLETION_PROVED_V2 ? 'default' : 'developer',
    evidence: TTRPG_COMPLETION_PROVED_V2 ? 'proved' : 'partial', userLabel: '本地跑团内核',
    reason: '世界承接、九步制作、完整车卡、深规则、逐行动反馈、奖惩/物品/次数、真人与 AI 席位、媒资、保存回放和长战役已形成开发环境完整链；非 fixture Golden A/B/C 与真实新用户门尚未密封通过。',
    requiresOnlineService: false, requiresAiGmBetaGate: false,
    allowedEnvironments: TTRPG_COMPLETION_PROVED_V2
      ? ['test', 'development', 'preview', 'production']
      : ['test', 'development'],
  },
  {
    id: 'ttrpg-ai-gm', rollout: 'experimental-project', evidence: 'partial', userLabel: 'AI 主持 Beta',
    reason: '合同、工具边界、有限修复和密封评测已完成；真实模型样本门未通过前不能称 Beta。',
    requiresOnlineService: false, requiresAiGmBetaGate: true,
    allowedEnvironments: ['test', 'development', 'preview', 'production'],
  },
  {
    id: 'online-authoritative-room', rollout: 'developer', evidence: 'partial', userLabel: '在线多人房间',
    reason: '权威协议、托管组合根、真实 HTTP 多账号、持久恢复、投影和可验证骰子已通过；尚未部署外部身份、数据库与实时服务。',
    requiresOnlineService: true, requiresAiGmBetaGate: false,
    allowedEnvironments: ['test', 'development', 'preview'],
  },
  {
    id: 'release-catalog', rollout: 'developer', evidence: 'partial', userLabel: '作品目录与社区',
    reason: '目录、发行物、权利审核、许可、领取、验证评论和治理已进入统一 HTTP 服务；尚未部署外部身份、搜索和对象存储。',
    requiresOnlineService: true, requiresAiGmBetaGate: false,
    allowedEnvironments: ['test', 'development', 'preview'],
  },
  {
    id: 'commerce-payments', rollout: 'developer', evidence: 'partial', userLabel: '交易与结算',
    reason: '订单、签名回执、权益、退款、运营与双边账本已进入统一托管组合；真实支付商、税务、风控和部署灾备尚未接入。',
    requiresOnlineService: true, requiresAiGmBetaGate: false,
    allowedEnvironments: ['test', 'development'],
  },
])

const CAPABILITY_BY_ID = new Map(PRODUCT_PLATFORM_CAPABILITIES_V1.map(item => [item.id, item]))

export function getProductPlatformCapabilityStatusV1(
  id: ProductPlatformCapabilityIdV1,
): ProductPlatformCapabilityStatusV1 {
  const capability = CAPABILITY_BY_ID.get(id)
  if (!capability) throw new Error(`[product-platform-capability] 未登记能力:${id}`)
  return structuredClone(capability)
}

export function evaluateProductPlatformCapabilityV1(
  id: ProductPlatformCapabilityIdV1,
  context: ProductPlatformCapabilityContextV1,
): ProductPlatformCapabilityDecisionV1 {
  const capability = getProductPlatformCapabilityStatusV1(id)
  const blockers: string[] = []
  if (capability.rollout === 'disabled') blockers.push('能力当前禁用')
  if (!capability.allowedEnvironments.includes(context.environment)) blockers.push(`环境 ${context.environment} 未获准`)
  if (capability.rollout === 'developer' && !['test', 'development'].includes(context.environment)) {
    blockers.push('仅开发环境开放')
  }
  if (capability.rollout === 'experimental-project' && !context.experimentalProject) {
    blockers.push('项目未显式加入实验')
  }
  if (capability.rollout === 'author-opt-in' && !context.authorOptIn) blockers.push('作者尚未显式启用')
  if (capability.requiresOnlineService && !context.onlineServiceConfigured) blockers.push('在线服务未配置')
  // Development/preview may exercise an explicitly enrolled experimental
  // project. Production is the only boundary where the sealed real-model gate
  // can promote that experiment into an end-user reachable capability.
  if (capability.requiresAiGmBetaGate && context.environment === 'production'
    && !context.aiGmBetaGatePassed) blockers.push('AI GM 真实样本门未通过')
  return { enabled: blockers.length === 0, capability, blockers }
}

export function currentProductPlatformEnvironmentV1(): ProductPlatformEnvironmentV1 {
  if (import.meta.env.MODE === 'test') return 'test'
  return import.meta.env.PROD ? 'production' : 'development'
}

export function validateAiGmBetaDeploymentAttestationV1(input: {
  gate: string | undefined
  policyVersion: string | undefined
  reportHash: string | undefined
}): boolean {
  return input.gate === 'passed'
    && input.policyVersion === 'ttrpg-gm-beta-gate-v1'
    && /^[0-9a-f]{64}$/.test(input.reportHash ?? '')
}

/** Fail closed: production promotion is bound to a sealed report and policy. */
export function currentAiGmBetaGatePassedV1(): boolean {
  return validateAiGmBetaDeploymentAttestationV1({
    gate: import.meta.env.VITE_STORYFORGE_TTRPG_AI_GM_BETA_GATE,
    policyVersion: import.meta.env.VITE_STORYFORGE_TTRPG_AI_GM_BETA_POLICY_VERSION,
    reportHash: import.meta.env.VITE_STORYFORGE_TTRPG_AI_GM_BETA_REPORT_HASH,
  })
}
