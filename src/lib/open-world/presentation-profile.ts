import type { ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { runConfiguredProductionTextV1, type ProviderBindingReceiptV1 } from '../product-production/capabilities'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import type { ProductProductionTaskExecutionResultV1, ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import type { AssembleContextInput } from '../registry/types'
import type {
  ProductBuildArtifactRecordV1,
  TextOpenWorldExperienceContractV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldPresentationProfileV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.presentation-profile.v1'
const INPUT_KEYS = ['text-open-world.game-brief', 'text-open-world.experience-contract'] as const

export interface TextOpenWorldPresentationProfileInputContextV1 {
  schema: 'storyforge.text-open-world-presentation-profile-input'
  version: 1
  productInstanceKey: string
  gameBrief: TextOpenWorldGameBriefV1
  experienceContract: TextOpenWorldExperienceContractV1
  contextSelectionHash: string
}

export interface TextOpenWorldPresentationProfileModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldPresentationProfileModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldPresentationProfileModelExecutionV1>

interface PresentationDraftV1 {
  title: string
  designIntent: string
  colorMood: string
  typographyTone: string
  contentLanguage: string
  fallbackTexts: Array<{ slotNumber: number; text: string }>
}

const CONSUMER_DEFINITIONS = [
  ['creation.overview', 'creation', '显示来源、设定、预算与生产状态'],
  ['play.scene', 'play', '显示当前场景叙述、事件反馈与对话'],
  ['play.system-actions', 'play', '显示当前可执行系统行动'],
  ['play.fixed-choices', 'play', '显示场景固定选项'],
  ['play.natural-language', 'play', '接收自然语言并展示映射或引导'],
  ['overlay.map', 'overlay', '显示SVG地图、地点、路径与快速旅行点'],
  ['overlay.quest-log', 'overlay', '显示主线、重要故事线、普通任务和追踪'],
  ['overlay.character', 'overlay', '显示等级、三属性、状态和成长'],
  ['overlay.skills', 'overlay', '显示技能、资源和解锁来源'],
  ['overlay.inventory', 'overlay', '显示背包、物品、材料与货币'],
  ['overlay.equipment', 'overlay', '显示武器、防具、饰品三装备位'],
  ['overlay.crafting', 'overlay', '显示已学配方、材料和制作结果'],
  ['overlay.shop', 'overlay', '显示商店库存、价格和关系影响'],
  ['overlay.combat', 'overlay', '显示回合战斗、技能、道具与逃跑'],
  ['overlay.relationships', 'overlay', '显示道德、阵营亲合度和三档态度'],
  ['overlay.world-status', 'overlay', '显示日期、时段、天气、传闻与近期事件'],
  ['system.save-branches', 'system', '显示有限手动存档、读档与分支'],
  ['system.settings-help', 'system', '显示设置、逐步提示和降级说明'],
] as const

function fail(message: string): never { throw new Error(`[text-open-world-presentation-profile] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => actual[index] !== key)) fail(`${label}字段不精确:${actual.join(',')}`)
}
function text(value: unknown, label: string, maximum = 1_000): string {
  if (typeof value !== 'string') fail(`${label}必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label}为空或过长`)
  return normalized
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label}整数无效`)
  return value
}
async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const actual = value[hashKey]
  if (!isSha256Hash(actual)) fail(`${label}.${hashKey}无效`)
  const body = { ...value }; delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== actual) fail(`${label}内容Hash不匹配`)
}

function parseAccepted<T>(rows: ProductBuildArtifactRecordV1[], key: typeof INPUT_KEYS[number], schema: string, hashKey: string): T {
  const row = rows.find(item => item.artifactKey === key) ?? fail(`缺少${key}`)
  const payload = record(JSON.parse(row.payloadJson), key)
  if (payload.schema !== schema || payload.version !== 1) fail(`${key}身份无效`)
  if (!isSha256Hash(payload[hashKey])) fail(`${key}.${hashKey}无效`)
  return payload as T
}

async function readInput(scope: WorkspaceScope, buildId: number): Promise<TextOpenWorldPresentationProfileInputContextV1> {
  const rows = await readAcceptedBuildArtifacts({ scope, buildId })
  if (rows.filter(row => INPUT_KEYS.includes(row.artifactKey as typeof INPUT_KEYS[number])).length !== INPUT_KEYS.length) fail('P2表现输入Artifact不完整')
  for (const key of INPUT_KEYS) {
    const row = rows.find(item => item.artifactKey === key)!
    const payload = record(JSON.parse(row.payloadJson), key)
    if (row.contentHash !== await hashProductProductionValueV2(payload)) fail(`${key}记录Hash不匹配`)
  }
  const gameBrief = parseAccepted<TextOpenWorldGameBriefV1>(rows, 'text-open-world.game-brief', 'storyforge.text-open-world-game-brief', 'gameBriefHash')
  const experienceContract = parseAccepted<TextOpenWorldExperienceContractV1>(rows, 'text-open-world.experience-contract', 'storyforge.text-open-world-experience-contract', 'experienceContractHash')
  await assertOwnHash(gameBrief as unknown as Record<string, unknown>, 'gameBriefHash', 'GameBrief')
  await assertOwnHash(experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract')
  if (experienceContract.productInstanceKey !== gameBrief.productInstanceKey
    || experienceContract.gameBriefHash !== gameBrief.gameBriefHash) fail('P2表现输入作用域或Hash链不一致')
  const base = {
    schema: 'storyforge.text-open-world-presentation-profile-input' as const,
    version: 1 as const,
    productInstanceKey: gameBrief.productInstanceKey,
    gameBrief,
    experienceContract,
  }
  return { ...base, contextSelectionHash: await hashProductProductionValueV2(base) }
}

export async function readTextOpenWorldPresentationProfileInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !input.productBuildId) fail('缺少scope或productBuildId')
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不存在或跨Work')
  return canonicalProductProductionJsonV2(await readInput(input.scope, build.id!))
}

async function parseContext(value: string): Promise<TextOpenWorldPresentationProfileInputContextV1> {
  const row = record(parseProductionModelJsonObjectV1(value, 'text-open-world-presentation-profile-input'), 'context')
  exactKeys(row, ['schema', 'version', 'productInstanceKey', 'gameBrief', 'experienceContract', 'contextSelectionHash'], 'context')
  if (row.schema !== 'storyforge.text-open-world-presentation-profile-input' || row.version !== 1 || !isSha256Hash(row.contextSelectionHash)) fail('Context身份无效')
  const body = { ...row }; delete body.contextSelectionHash
  if (await hashProductProductionValueV2(body) !== row.contextSelectionHash) fail('Context选择Hash不匹配')
  const context = row as unknown as TextOpenWorldPresentationProfileInputContextV1
  await assertOwnHash(context.gameBrief as unknown as Record<string, unknown>, 'gameBriefHash', 'GameBrief')
  await assertOwnHash(context.experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract')
  if (context.productInstanceKey !== context.gameBrief.productInstanceKey
    || context.experienceContract.productInstanceKey !== context.productInstanceKey
    || context.experienceContract.gameBriefHash !== context.gameBrief.gameBriefHash) fail('Context跨产品或Hash链无效')
  return context
}

function parseDraft(value: unknown): PresentationDraftV1 {
  const row = record(value, 'draft')
  exactKeys(row, ['schema', 'version', 'title', 'designIntent', 'colorMood', 'typographyTone', 'contentLanguage', 'fallbackTexts'], 'draft')
  if (row.schema !== 'storyforge.text-open-world-presentation-profile-draft' || row.version !== 1 || !Array.isArray(row.fallbackTexts)) fail('draft身份无效')
  const fallbackTexts = row.fallbackTexts.map((item, index) => {
    const entry = record(item, `fallbackTexts[${index}]`)
    exactKeys(entry, ['slotNumber', 'text'], `fallbackTexts[${index}]`)
    return { slotNumber: integer(entry.slotNumber, `fallbackTexts[${index}].slotNumber`, 1, CONSUMER_DEFINITIONS.length), text: text(entry.text, `fallbackTexts[${index}].text`, 240) }
  })
  if (fallbackTexts.length !== CONSUMER_DEFINITIONS.length
    || new Set(fallbackTexts.map(item => item.slotNumber)).size !== fallbackTexts.length) fail('必须逐项提供全部消费槽文字降级')
  const language = text(row.contentLanguage, 'contentLanguage', 32)
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail('contentLanguage必须是BCP47形式')
  return {
    title: text(row.title, 'title', 120), designIntent: text(row.designIntent, 'designIntent'),
    colorMood: text(row.colorMood, 'colorMood', 240), typographyTone: text(row.typographyTone, 'typographyTone', 240),
    contentLanguage: language,
    fallbackTexts: fallbackTexts.sort((a, b) => a.slotNumber - b.slotNumber),
  }
}

async function createArtifact(input: {
  context: TextOpenWorldPresentationProfileInputContextV1
  draft: PresentationDraftV1
  createdAt: number
}): Promise<TextOpenWorldPresentationProfileV1> {
  const { context, draft, createdAt } = input
  const body: Omit<TextOpenWorldPresentationProfileV1, 'presentationProfileHash'> = {
    schema: 'storyforge.text-open-world-presentation-profile', version: 1, productType: 'text-open-world',
    productInstanceKey: context.productInstanceKey, gameBriefHash: context.gameBrief.gameBriefHash,
    experienceContractHash: context.experienceContract.experienceContractHash,
    theme: {
      title: draft.title, designIntent: draft.designIntent, colorMood: draft.colorMood,
      typographyTone: draft.typographyTone, informationDensity: 'comfortable',
      mapStyle: 'svg-terrain-with-interactive-nodes',
    },
    consumerSlots: CONSUMER_DEFINITIONS.map(([key, surface, purpose], index) => ({
      key, surface, purpose, required: true as const, textFallback: draft.fallbackTexts[index]!.text,
    })),
    interactionPresentation: {
      acceptedInputs: ['system-action', 'fixed-choice', 'natural-language'],
      combatControls: ['fight', 'escape', 'skill', 'item'],
      impossibleActionPolicy: 'explicit-decline-with-in-world-alternative',
      offTrackPolicy: 'natural-response-then-mainline-redirect',
      modelFailurePolicy: 'show-formal-actions-and-safe-template',
    },
    mediaPolicy: {
      visualLevel: context.gameBrief.media.visualLevel, audioLevel: context.gameBrief.media.audioLevel,
      requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
      textFallbackRequired: true, missingMediaPolicy: 'placeholder-with-text-playable',
      authorizedMaximumMediaCalls: context.gameBrief.effectiveProductionBudget.maximumMediaCalls,
    },
    contentLanguage: draft.contentLanguage,
    governance: {
      allRequiredConsumersDeclared: true, gameplayResultNeverOwnedByPresentation: true,
      stableIdsNeverUseDisplayText: true, textOnlyReleasePlayable: true,
    },
    basisHash: context.contextSelectionHash, createdAt,
  }
  return { ...body, presentationProfileHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldPresentationProfileV1): unknown {
  return {
    schema: 'storyforge.text-open-world-presentation-profile-draft',
    version: 1,
    title: artifact.theme.title,
    designIntent: artifact.theme.designIntent,
    colorMood: artifact.theme.colorMood,
    typographyTone: artifact.theme.typographyTone,
    contentLanguage: artifact.contentLanguage,
    fallbackTexts: artifact.consumerSlots.map((slot, index) => ({
      slotNumber: index + 1,
      text: slot.textFallback,
    })),
  }
}

export async function validateTextOpenWorldPresentationProfileV1(input: {
  artifact: TextOpenWorldPresentationProfileV1
  context: TextOpenWorldPresentationProfileInputContextV1 | string
}): Promise<TextOpenWorldPresentationProfileV1> {
  const artifact = input.artifact
  if (artifact.schema !== 'storyforge.text-open-world-presentation-profile' || artifact.version !== 1 || !isSha256Hash(artifact.presentationProfileHash)) fail('PresentationProfile身份无效')
  await assertOwnHash(artifact as unknown as Record<string, unknown>, 'presentationProfileHash', 'PresentationProfile')
  const context = await parseContext(typeof input.context === 'string' ? input.context : canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(artifact))
  const expected = await createArtifact({ context, draft, createdAt: artifact.createdAt })
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(artifact)) fail('PresentationProfile内容或固定边界被篡改')
  return artifact
}

export async function projectTextOpenWorldPresentationProfileAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldPresentationProfileV1
  context: TextOpenWorldPresentationProfileInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldPresentationProfileV1({ artifact: input.artifact, context })
  const draft = draftFromArtifact(artifact)
  parseDraft(draft)
  return structuredClone(draft)
}

export async function rebuildTextOpenWorldPresentationProfileFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldPresentationProfileV1
  context: TextOpenWorldPresentationProfileInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldPresentationProfileV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldPresentationProfileV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldPresentationProfileV1({ artifact, context })
}

function prompts(context: TextOpenWorldPresentationProfileInputContextV1) {
  return {
    system: [
      '你是StoryForge文字开放世界的界面表现设计师。只能返回JSON。',
      '你只负责主题语义和文字降级文案；消费槽、交互模式、媒资级别和运行规则由代码冻结。',
      '所有界面在没有图片、音频或运行期模型时也必须可理解、可操作。',
    ].join('\n'),
    user: [
      `为${CONSUMER_DEFINITIONS.length}个消费槽按slotNumber顺序各写一条简短text，说明媒资/模型失败时如何以文字继续。`,
      '给出title/designIntent/colorMood/typographyTone和一个BCP47 contentLanguage。',
      '返回：{"schema":"storyforge.text-open-world-presentation-profile-draft","version":1,"title":"...","designIntent":"...","colorMood":"...","typographyTone":"...","contentLanguage":"zh-CN","fallbackTexts":[{"slotNumber":1,"text":"..."}]}',
      `体验标题：${context.experienceContract.title}；调性：${context.experienceContract.toneGuide.join('、')}。`,
    ].join('\n'),
  }
}

async function defaultRunner(input: Parameters<TextOpenWorldPresentationProfileModelRunnerV1>[0]): Promise<TextOpenWorldPresentationProfileModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `<presentation-input>\n${input.contextText}\n</presentation-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldPresentationProfileExecutorV1(options: {
  runModel?: TextOpenWorldPresentationProfileModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p2.presentation-profile' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('执行器收到错误任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.presentation-profile'])) fail('P2表现输出不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('P2表现需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey) ?? fail('P2表现缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = prompts(context); const started = performance.now()
    const model = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: SKILL_ID,
      system: `${prompt.system}\n${prompt.user}`, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(8_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(model.output, 'text-open-world-presentation-profile'))
    const artifact = await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) })
    await validateTextOpenWorldPresentationProfileV1({ artifact, context })
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [{
        artifactKey: 'text-open-world.presentation-profile', kind: 'text-open-world.presentation-profile', payload: artifact,
        quality: { consumerSlotCount: artifact.consumerSlots.length, textFallbackReady: true, interactionModesFrozen: true },
        rights: { sourceLedgerHash: context.gameBrief.source.sourceLedgerHash },
      }],
      usage: {
        modelCalls: 1, inputTokens: model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + execution.contextText),
        outputTokens: model.usage?.outputTokens ?? estimateTokens(model.output), mediaCalls: 0, costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - started)), storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    }
    return result
  }
}
