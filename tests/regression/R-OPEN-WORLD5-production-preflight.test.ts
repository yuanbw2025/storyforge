import { describe, expect, it } from 'vitest'
import type { AIConfig, TextOpenWorldCreatorBriefV1 } from '../../src/lib/types'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
  describeTextOpenWorldProviderFailureV1,
  verifyTextOpenWorldCreatorProductionPreflightConfirmationV1,
  verifyTextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/open-world/creator-production-preflight'
import { knownProviderModelPrice } from '../../src/lib/ai/usage-log'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const HASH = (character: string) => character.repeat(64)

async function brief(overrides: Partial<TextOpenWorldCreatorBriefV1> = {}): Promise<TextOpenWorldCreatorBriefV1> {
  const sourceBinding = {
    kind: 'novel' as const, workCode: 'work.river-lantern', sourceVersionHash: HASH('a'),
    sourceBoundaryHash: HASH('b'), coverage: 'full-text' as const, selectionMode: 'entire-work' as const,
    selectedChapterCount: 8, selectedOutlineCount: 3,
  }
  const base: Omit<TextOpenWorldCreatorBriefV1, 'briefHash'> = {
    schema: 'storyforge.text-open-world-creator-brief', version: 1,
    productInstanceKey: 'text-open-world.primary.river-lantern', revision: 1,
    sourceBinding,
    sourceBindingHash: await hashCanonicalValue(sourceBinding),
    sourceSummary: {
      label: '河灯长夜 · 整部小说', sourceKind: 'novel', coverage: 'full-text',
      resourceCount: 12, rowOrWordCount: 42_000, capabilityAreas: ['story'], gaps: [],
    },
    draft: {
      schema: 'storyforge.text-open-world-creator-brief-draft', version: 1,
      gameTitle: '河灯长夜', playerRole: '巡灯人', playerFantasy: '在河谷中冒险',
      protagonistMode: 'author-defined', protagonistDirective: '追查失踪河灯',
      coreGoal: '恢复航道', primaryConflict: '河流秩序冲突', openingSituation: '旧渡口接案',
      experiencePillars: ['探索', '长期成长'], toneKeywords: ['民俗'], mustKeep: ['河灯标记航道'],
      allowedInferences: ['补齐支线'], forbiddenChanges: ['不得改写来源事实'],
      contentRating: '12+', contentBoundaries: ['不表现露骨伤害'], authorNotes: '',
      unresolvedQuestions: [], acceptedAssumptions: [],
      scale: {
        regions: 2, namedLocations: { minimum: 8, maximum: 12 },
        mainlineStages: { minimum: 6, maximum: 8 }, endings: 2,
        significantStorylines: 2, ordinaryQuests: { minimum: 6, maximum: 10 },
        taskTemplates: { minimum: 4, maximum: 6 }, randomEvents: { minimum: 12, maximum: 20 },
        requiredPlayMinutes: { minimum: 90, maximum: 120 },
        optionalInventoryMinutes: { minimum: 180, maximum: 300 },
      },
      media: {
        proceduralMap: 'required', characterPortraits: 'required', sceneBackgrounds: 'required',
        audio: 'none', artDirection: '低饱和像素风',
      },
      completion: {
        playablePreviewRequired: true, deterministicGatesRequired: true,
        semanticReviewRequired: true, publishAfterGates: true,
        humanPlaytest: 'post-release', repairPolicy: 'new-release',
      },
    },
    productBoundary: {
      freedomModel: 'bounded-guided', mainlineStructure: 'strict-sequential-with-multiple-endings',
      mainlineWaitsForPlayer: true, significantStorylinesWaitAtSafePoints: true,
      ordinaryWorldContinues: true, criticalActorsProtected: true, criticalItemsProtected: true,
      freeTextPolicy: 'respond-then-redirect-or-reject', unsupportedSolutionPolicy: 'declared-actions-only',
      combatMode: 'turn-based-four-actions', difficulty: 'standard',
      locationOnlyCriticalTriggersForbidden: true,
    },
    confirmation: {
      sourceIdentityReviewed: true, productBoundaryReviewed: true,
      unresolvedItemsClosed: true, directPublishWorkflowReviewed: true,
    },
    candidateEvidence: {
      candidateHash: HASH('d'), runBindingHash: HASH('e'), origin: 'author', contextManifestHashes: [HASH('1')],
    },
    confirmedAt: 1_788_000_000_000,
  }
  const { briefHash: overriddenHash, ...withoutHash } = overrides
  const body = { ...base, ...withoutHash }
  return { ...body, briefHash: overriddenHash ?? await hashCanonicalValue(body) }
}

function config(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    provider: 'deepseek', apiKey: 'totally-arbitrary-private-value',
    model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1',
    temperature: 0.7, maxTokens: 0, ...overrides,
  }
}

function runtime(aiConfig: AIConfig = config(), rememberApiKey = false) {
  return { projectId: 7, aiConfig, rememberApiKey }
}

const ACKNOWLEDGEMENT = {
  credentialPolicyReviewed: true,
  providerAndModelReviewed: true,
  priceAndBudgetReviewed: true,
  mediaCostBoundaryReviewed: true,
}

describe('TOW-G5-03 · creator production preflight', () => {
  it('以 provider-qualified 报价形成不含 Key/完整 URL 的 187/200 文本预算快照', async () => {
    const result = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(), projectId: 7, aiConfig: config(), rememberApiKey: false, pricing: { mode: 'catalog' },
    })

    expect(result).toMatchObject({
      ready: true,
      providerBinding: {
        provider: 'deepseek', model: 'deepseek-v4-flash',
        endpointOrigin: 'https://api.deepseek.com', credentialMode: 'session',
      },
      estimate: {
        recommendedModelCalls: 187, maximumModelCalls: 200,
        reservedInputTokens: 1_200_000, reservedOutputTokens: 360_000,
        maximumCostUsd: 30, maximumDurationMs: 7_200_000,
        maximumStorageBytes: 200_000_000,
      },
      priceQuote: { source: 'storyforge-catalog' },
    })
    expect(result.estimate.estimatedTextCostUsd).toBeCloseTo(0.2688)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('totally-arbitrary-private-value')
    expect(serialized).not.toContain('/v1')
    expect(result.providerBinding.endpointRouteHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('内置价格目录只接受已复核的 provider 与精确模型 ID', () => {
    expect(knownProviderModelPrice('deepseek', 'deepseek-v4-flash')).toEqual({ input: 0.14, output: 0.28 })
    expect(knownProviderModelPrice('openai', 'gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 })
    expect(knownProviderModelPrice('openai', 'gpt-4.1-2025-04-14')).toEqual({ input: 2.5, output: 10 })
    expect(knownProviderModelPrice('gemini', 'gemini-3.5-flash')).toEqual({ input: 1.5, output: 9 })
    expect(knownProviderModelPrice('claude', 'claude-sonnet-4-20250514')).toEqual({ input: 3, output: 15 })

    expect(knownProviderModelPrice('nvidia', 'deepseek-v4-flash')).toBeNull()
    expect(knownProviderModelPrice('claude', 'claude-anything')).toBeNull()
    expect(knownProviderModelPrice('openai', 'gpt-4.10')).toBeNull()
    expect(knownProviderModelPrice('openai', 'gpt-4.1-preview')).toBeNull()
    expect(knownProviderModelPrice('openai', 'gpt-4o-mini-experimental')).toBeNull()
    expect(knownProviderModelPrice('openai', 'GPT-4O')).toBeNull()
    expect(knownProviderModelPrice('openai', 'gpt-4.1-9999-99-99')).toBeNull()
    expect(knownProviderModelPrice('openai', 'gpt-4o-0000-00-00')).toBeNull()
    expect(knownProviderModelPrice('qwen', 'qwen-anything')).toBeNull()
    expect(knownProviderModelPrice('qwen', 'qwen-max-2099-99-99')).toBeNull()
    expect(knownProviderModelPrice('gemini', 'gemini-anything-flash')).toBeNull()
  })

  it('同名模型不能跨 provider 套价，未知价格可由作者报价但超出 $30 时失败关闭', async () => {
    expect(knownProviderModelPrice('nvidia', 'deepseek-v4-flash')).toBeNull()
    const unknown = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(),
      projectId: 7,
      aiConfig: config({ provider: 'nvidia', model: 'deepseek-v4-flash', baseUrl: 'https://integrate.api.nvidia.com/v1' }),
      rememberApiKey: false, pricing: { mode: 'catalog' },
    })
    expect(unknown.ready).toBe(false)
    expect(unknown.priceQuote).toBeNull()
    expect(unknown.blockers.join('')).toContain('没有可验证的内置价格')

    const relay = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(),
      projectId: 7,
      aiConfig: config({ baseUrl: 'https://relay.example.com/deepseek/v1' }),
      rememberApiKey: false,
      pricing: { mode: 'catalog' },
    })
    expect(relay.ready).toBe(false)
    expect(relay.priceQuote).toBeNull()
    expect(relay.blockers.join('')).toContain('商业端点没有可验证的内置价格')

    const manual = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(),
      projectId: 7,
      aiConfig: config({ provider: 'nvidia', model: 'deepseek-v4-flash', baseUrl: 'https://integrate.api.nvidia.com/v1' }),
      rememberApiKey: false,
      pricing: { mode: 'manual', manual: {
        inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8,
        sourceLabel: '供应商官方定价页，作者已核对', asOf: '2026-09-09',
      } },
    })
    expect(manual.ready).toBe(true)
    expect(manual.estimate.estimatedTextCostUsd).toBeCloseTo(5.28)

    const overBudget = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(), projectId: 7, aiConfig: config(), rememberApiKey: false,
      pricing: { mode: 'manual', manual: {
        inputUsdPerMillionTokens: 20, outputUsdPerMillionTokens: 20,
        sourceLabel: '供应商官方定价页，作者已核对', asOf: '2026-09-09',
      } },
    })
    expect(overBudget.ready).toBe(false)
    expect(overBudget.estimate.estimatedTextCostUsd).toBeCloseTo(31.2)
    expect(overBudget.blockers.join('')).toContain('超过单 Build $30.00')
  })

  it('只有明确本地的 Ollama/custom 可确认零 token 费用，远程空 Key 始终阻断', async () => {
    const local = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(),
      projectId: 7,
      aiConfig: config({ provider: 'ollama', apiKey: '', model: 'qwen2.5:7b', baseUrl: 'http://localhost:11434/v1' }),
      rememberApiKey: false, pricing: { mode: 'local-zero' },
    })
    expect(local).toMatchObject({
      ready: true,
      providerBinding: { endpointOrigin: 'http://localhost:11434', credentialMode: 'local-no-key' },
      priceQuote: { source: 'author-confirmed-local-zero', inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
      estimate: { estimatedTextCostUsd: 0 },
    })

    const remote = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: await brief(),
      projectId: 7,
      aiConfig: config({ provider: 'custom', apiKey: '', model: 'private-model', baseUrl: 'https://relay.example.com/v1' }),
      rememberApiKey: false, pricing: { mode: 'local-zero' },
    })
    expect(remote.ready).toBe(false)
    expect(remote.blockers.join('')).toContain('没有可用 API Key')
    expect(remote.blockers.join('')).toContain('零 token 费用只允许')
  })

  it('确认绑定 Brief、来源、模型、端点、报价和预算，任一快照变化都要求重确认', async () => {
    const confirmedBrief = await brief()
    const first = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief, projectId: 7, aiConfig: config(), rememberApiKey: false, pricing: { mode: 'catalog' },
    })
    const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief, preflight: first, ...runtime(),
      acknowledgement: ACKNOWLEDGEMENT, confirmedAt: 1_788_000_000_100,
    })
    await expect(verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
      brief: confirmedBrief, preflight: first, confirmation, ...runtime(),
    })).resolves.toEqual(confirmation)

    const changedBrief = await brief({ revision: 2, confirmedAt: 1_788_000_000_200 })
    const changed = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: changedBrief,
      projectId: 7,
      aiConfig: config({ baseUrl: 'https://backup.deepseek.com/v1' }),
      rememberApiKey: false, pricing: { mode: 'catalog' },
    })
    await expect(verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
      brief: changedBrief, preflight: changed, confirmation,
      ...runtime(config({ baseUrl: 'https://backup.deepseek.com/v1' })),
    })).rejects.toThrow('已经变化')

    const tampered = structuredClone(first)
    tampered.estimate.estimatedTextCostUsd = 0
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(tampered, {
      brief: confirmedBrief,
      ...runtime(),
    })).rejects.toThrow('Hash 不匹配')
  })

  it('即使攻击者重算 Hash，也拒绝伪造凭证状态、额外字段和不完整作者确认', async () => {
    const confirmedBrief = await brief()
    const first = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief, projectId: 7, aiConfig: config(), rememberApiKey: false,
      pricing: { mode: 'catalog' },
    })
    const forged = structuredClone(first) as unknown as Record<string, unknown>
    const binding = forged.providerBinding as Record<string, unknown>
    binding.credentialPresent = false
    binding.credentialReady = true
    binding.credentialMode = 'session'
    const { bindingHash: _bindingHash, ...bindingBody } = binding
    binding.bindingHash = await hashCanonicalValue(bindingBody)
    const { preflightHash: _preflightHash, ...preflightBody } = forged
    forged.preflightHash = await hashCanonicalValue(preflightBody)
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(forged, {
      brief: confirmedBrief,
      ...runtime(),
    })).rejects.toThrow('凭证状态自相矛盾')

    const extra = structuredClone(first) as unknown as Record<string, unknown>
    extra.secretOverride = true
    const { preflightHash: _oldHash, ...extraBody } = extra
    extra.preflightHash = await hashCanonicalValue(extraBody)
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(extra, {
      brief: confirmedBrief,
      ...runtime(),
    })).rejects.toThrow('字段不精确')

    const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief, preflight: first, ...runtime(), acknowledgement: ACKNOWLEDGEMENT,
      confirmedAt: 1_788_000_000_100,
    })
    const forgedConfirmation = structuredClone(confirmation) as unknown as Record<string, unknown>
    const acknowledgement = forgedConfirmation.acknowledgement as Record<string, unknown>
    acknowledgement.credentialPolicyReviewed = false
    const { confirmationHash: _confirmationHash, ...confirmationBody } = forgedConfirmation
    forgedConfirmation.confirmationHash = await hashCanonicalValue(confirmationBody)
    await expect(verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
      brief: confirmedBrief, preflight: first, confirmation: forgedConfirmation, ...runtime(),
    })).rejects.toThrow('作者确认项不完整')
  })

  it('以当前任务路由作为外部事实，拒绝自洽重算的 Key 与端点路径伪造', async () => {
    const confirmedBrief = await brief()
    const missingKeyConfig = config({ apiKey: '' })
    const missing = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(missingKeyConfig),
      pricing: { mode: 'catalog' },
    })
    const forged = structuredClone(missing) as unknown as Record<string, unknown>
    const binding = forged.providerBinding as Record<string, unknown>
    binding.credentialPresent = true
    binding.credentialReady = true
    binding.credentialMode = 'session'
    const { bindingHash: _oldBindingHash, ...bindingBody } = binding
    binding.bindingHash = await hashCanonicalValue(bindingBody)
    forged.blockers = []
    forged.ready = true
    const { preflightHash: _oldPreflightHash, ...preflightBody } = forged
    forged.preflightHash = await hashCanonicalValue(preflightBody)
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(forged, {
      brief: confirmedBrief,
      ...runtime(missingKeyConfig),
    })).rejects.toThrow('凭证状态已变化')

    const first = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(),
      pricing: { mode: 'catalog' },
    })
    expect(first.providerBinding.endpointOrigin).toBe('https://api.deepseek.com')
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(first, {
      brief: confirmedBrief,
      ...runtime(config({ baseUrl: 'https://api.deepseek.com/another-tenant/v1' })),
    })).rejects.toThrow('端点或凭证状态已变化')
  })

  it('远程 HTTP、URL 内嵌凭证和越界参数都失败关闭，且工厂产物仍可自验', async () => {
    const confirmedBrief = await brief()
    const remoteHttp = config({ baseUrl: 'http://relay.example.com/v1' })
    const insecure = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(remoteHttp),
      pricing: { mode: 'manual', manual: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 3,
        sourceLabel: '供应商报价，作者已核对',
        asOf: '2026-09-09',
      } },
    })
    expect(insecure.ready).toBe(false)
    expect(insecure.blockers.join('')).toContain('远程模型必须使用 HTTPS')
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(insecure, {
      brief: confirmedBrief,
      ...runtime(remoteHttp),
    })).resolves.toEqual(insecure)

    const unsafeUrl = config({
      baseUrl: 'https://user:password@api.deepseek.com/v1?api_key=hidden#secret',
    })
    const unsafe = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(unsafeUrl),
      pricing: { mode: 'catalog' },
    })
    expect(unsafe.ready).toBe(false)
    expect(unsafe.blockers.join('')).toContain('不能包含用户名、密码、查询参数')
    expect(JSON.stringify(unsafe)).not.toMatch(/user:password|api_key|hidden|\/v1/)

    const oversizedConfig = config({ temperature: 2.1, maxTokens: 65_537, contextWindow: 131_072.5 })
    const oversized = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(oversizedConfig),
      pricing: { mode: 'catalog' },
    })
    expect(oversized.ready).toBe(false)
    expect(oversized.blockers.join('')).toContain('模型温度配置无效')
    expect(oversized.blockers.join('')).toContain('模型输出上限配置无效')
    expect(oversized.blockers.join('')).toContain('模型上下文窗口配置无效')
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(oversized, {
      brief: confirmedBrief,
      ...runtime(oversizedConfig),
    })).resolves.toEqual(oversized)

    const supportedBoundary = config({ temperature: 2, maxTokens: 65_536, contextWindow: 1_000_000_000 })
    const boundary = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(supportedBoundary),
      pricing: { mode: 'catalog' },
    })
    expect(boundary.ready).toBe(true)
    await expect(verifyTextOpenWorldCreatorProductionPreflightV1(boundary, {
      brief: confirmedBrief,
      ...runtime(supportedBoundary),
    })).resolves.toEqual(boundary)
  })

  it('Key 被误贴进 hostname、path、query、model 或人工报价说明时绝不进入快照', async () => {
    const confirmedBrief = await brief()
    const secret = 'sk-credential-must-never-escape-123456'
    const otherSecret = 'sk-other-credential-must-not-escape-987654'
    const manual = {
      mode: 'manual' as const,
      manual: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 3,
        sourceLabel: '供应商报价，作者已核对',
        asOf: '2026-09-09',
      },
    }
    for (const baseUrl of [
      `https://${secret}.relay.example/v1`,
      `https://relay.example/${encodeURIComponent(secret)}/v1`,
      `https://relay.example/v1?token=${encodeURIComponent(secret)}`,
      `https://${otherSecret}.relay.example/v1`,
    ]) {
      const aiConfig = config({ apiKey: secret, baseUrl })
      const result = await createTextOpenWorldCreatorProductionPreflightV1({
        brief: confirmedBrief,
        ...runtime(aiConfig),
        pricing: manual,
      })
      expect(result.ready).toBe(false)
      expect(result.blockers.join('')).toContain('模型服务地址疑似包含凭证内容')
      expect(JSON.stringify(result)).not.toContain(secret)
      expect(JSON.stringify(result)).not.toContain(otherSecret)
      await expect(verifyTextOpenWorldCreatorProductionPreflightV1(result, {
        brief: confirmedBrief,
        ...runtime(aiConfig),
      })).resolves.toEqual(result)
    }

    const modelConfig = config({ apiKey: secret, model: `model-${secret}` })
    const modelResult = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(modelConfig),
      pricing: manual,
    })
    expect(modelResult.blockers.join('')).toContain('模型名称包含凭证内容')
    expect(JSON.stringify(modelResult)).not.toContain(secret)

    const labelResult = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(config({ apiKey: secret })),
      pricing: {
        ...manual,
        manual: { ...manual.manual, sourceLabel: `供应商报价 ${secret}` },
      },
    })
    expect(labelResult.blockers.join('')).toContain('不含 URL、查询参数或任何凭证内容')
    expect(JSON.stringify(labelResult)).not.toContain(secret)
  })

  it('确认入口拒绝空对象或任何缺失的确认字段', async () => {
    const confirmedBrief = await brief()
    const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(),
      pricing: { mode: 'catalog' },
    })
    await expect(confirmTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      preflight,
      ...runtime(),
      acknowledgement: {} as typeof ACKNOWLEDGEMENT,
    })).rejects.toThrow('字段不精确')
  })

  it('Verifier 拒绝在 blocker 或 warning 中注入凭证后重算 Hash', async () => {
    const confirmedBrief = await brief()
    const aiConfig = config()
    const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
      brief: confirmedBrief,
      ...runtime(aiConfig),
      pricing: { mode: 'catalog' },
    })
    for (const [field, injected] of [
      ['warnings', `诊断 ${aiConfig.apiKey}`],
      ['blockers', 'Bearer sk-another-credential-123456'],
    ] as const) {
      const forged = structuredClone(preflight) as unknown as Record<string, unknown>
      forged[field] = [...forged[field] as string[], injected]
      if (field === 'blockers') forged.ready = false
      const { preflightHash: _oldHash, ...body } = forged
      forged.preflightHash = await hashCanonicalValue(body)
      await expect(verifyTextOpenWorldCreatorProductionPreflightV1(forged, {
        brief: confirmedBrief,
        ...runtime(aiConfig),
      })).rejects.toThrow('疑似包含凭证内容')
    }
  })

  it('把余额、授权、限流、超时和断网转成安全且可行动的暂停说明', () => {
    expect(describeTextOpenWorldProviderFailureV1({ status: 429, body: 'insufficient balance' })).toMatchObject({
      kind: 'insufficient-balance', message: expect.stringContaining('没有隐藏重发'),
    })
    expect(describeTextOpenWorldProviderFailureV1({ status: 403, body: 'AccountOverdueError: overdue balance' }))
      .toMatchObject({ kind: 'insufficient-balance' })
    expect(describeTextOpenWorldProviderFailureV1({ status: 401 })).toMatchObject({ kind: 'authorization' })
    expect(describeTextOpenWorldProviderFailureV1({ status: 429, body: 'rate limit' })).toMatchObject({ kind: 'rate-limit' })
    expect(describeTextOpenWorldProviderFailureV1({ name: 'AbortError' })).toMatchObject({ kind: 'timeout' })
    expect(describeTextOpenWorldProviderFailureV1({ name: 'TypeError', message: 'Failed to fetch' })).toMatchObject({ kind: 'network' })
  })
})
