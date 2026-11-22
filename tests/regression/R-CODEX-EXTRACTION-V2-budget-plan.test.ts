import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { AIConfig, CodexCategory } from '../../src/lib/types'
import type { CapacityFactV2, ModelCapacityFactsV2 } from '../../src/lib/types/agent-run'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { assessCompleteRequestCapacityV2 } from '../../src/lib/ai/context-budget'
import { getModelCapacityV1, parseModelCapacityFactsV2, projectModelCapacityFactsV2, resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { captureRegisteredContextSourceV2 } from '../../src/lib/registry/assemble-context'
import { readCodexExtractionBaselineV1 } from '../../src/lib/codex/extraction'
import { createCodexContextMaterialV2, createCodexExtractionRootV2, assertCodexExtractionPlanV2 } from '../../src/lib/agent/run/codex-extraction-v2-contract'
import { buildCodexExtractionPlanV2, refineIncompleteCodexRangeV2 } from '../../src/lib/agent/run/codex-extraction-v2-plan'
import { freezeAIRequestAssessmentContextV2, prepareAIRequestV2, resolveRequestConfig } from '../../src/lib/ai/client'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const config: AIConfig = { provider: 'custom', model: 'b01-plan-synthetic', baseUrl: 'https://plan.invalid/v1', apiKey: '', temperature: 0, maxTokens: 4000 }
const now = 1000
const fact = (tokens: number, basis: NonNullable<CapacityFactV2>['basis'] = 'service'): CapacityFactV2 => ({ tokens, basis, sourceId: 'synthetic-service', verifiedAt: 1, expiresAt: 2000 })
const facts = (inputTokens: CapacityFactV2, contextTokens: CapacityFactV2 = null): ModelCapacityFactsV2 => ({ version: 2, routeHash: 'a'.repeat(64), inputTokens, contextTokens, outputTokens: null })
const assess = (capacity: ModelCapacityFactsV2, tokens: number, reliability: 'exact' | 'estimate' = 'exact', output: number | null = null) =>
  assessCompleteRequestCapacityV2({ capacity, measurement: { tokens, reliability, method: 'synthetic-complete-meter', version: '1' }, wireOutputTokens: output, now })

beforeEach(async () => { await db.delete(); await db.open(); resetModelCapacityForTestsV1(); useAIConfigStore.setState({ config, presets: [], taskRoutes: {} }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })

describe('B01 C01/C03/C04/C05/C09/C12/C22/C24/C26 · material and range plan', () => {
  it('keeps each capacity dimension unknown unless current actual-service evidence proves it', () => {
    expect(assess(facts(null), 1000000).decision).toBe('uncertain')
    expect(assess(facts(fact(8)), 9).decision).toBe('proved-overflow')
    expect(assess(facts(fact(8)), 9, 'estimate').decision).toBe('uncertain')
    expect(assess(facts(fact(8, 'declared-model')), 9).decision).toBe('uncertain')
    expect(assess(facts({ ...fact(8)!, expiresAt: now }), 9).decision).toBe('uncertain')
    expect(assess(facts(null, fact(20)), 10, 'exact', null).decision).toBe('uncertain')
    expect(assess(facts(null, fact(20)), 10, 'exact', 11).decision).toBe('proved-overflow')
    expect(assess(facts(null, fact(20)), 10, 'exact', 10).decision).toBe('fit')
    expect(assess(facts(fact(8)), 0).decision).toBe('fit')
    expect(() => assess(facts(null), NaN)).toThrow()
    expect(() => parseModelCapacityFactsV2({ ...facts(null), fakeWindow: 128000 })).toThrow()
  })

  it('does not elevate a fallback or a policy output to service proof', () => {
    const routeHash = 'a'.repeat(64), snapshot = getModelCapacityV1(config)
    expect(projectModelCapacityFactsV2(config, routeHash)).toMatchObject({ contextTokens: null, inputTokens: null, outputTokens: null })
    const service: AIConfig = { ...config, modelCapacity: { ...snapshot, confidence: 'service', totalWindow: 10000,
      outputLimitSource: 'policy', outputLimit: 4000 } }
    expect(projectModelCapacityFactsV2(service, routeHash).contextTokens?.tokens).toBe(10000)
    expect(projectModelCapacityFactsV2(service, routeHash).outputTokens).toBeNull()
  })

  it('captures the complete original through the registered reader and plans one uncertain full request', async () => {
    const { scope } = await seedCurrentWorkspace('B01 full capture')
    const at = Date.now(), categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(scope, 'codexCategories', { projectId: scope.projectId,
      domain: 'natural', parentId: null, name: '灵植', icon: '🌱', builtInKey: 'herb', fieldSchema: '[]', hidden: false,
      order: 0, createdAt: at, updatedAt: at }, { owner: 'world' }))
    await stampCurrentFixtureResourceUidsV1(scope.projectId)
    const sourceText = ' \r\n' + '月栖花😀\r\n'.repeat(4000) + '尾段不可丢失\n '
    const context = { projectId: scope.projectId, scope, worldGroupId: null, codexCategoryId: categoryId, manualSourceText: sourceText }
    const source = await captureRegisteredContextSourceV2({ sourceKey: 'manualText', context })
    const baseline = await captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionBaseline', context })
    const baselineState = await readCodexExtractionBaselineV1({ scope, worldGroupId: null, categoryId })
    expect(source.rawText).toBe(sourceText); expect(source.rawUTF16Length).toBe(sourceText.length)
    const root = await createCodexExtractionRootV2({ source, baseline, baselineStateHash: await hashCanonicalValue(baselineState),
      promptTemplateHash: 'e'.repeat(64), supplementTags: false })
    expect(root.lengthPlan).toBeNull()
    const material = await createCodexContextMaterialV2({ root, source, baseline, inputTokenForecast: 0 })
    const resolution = resolveRequestConfig(config, { category: 'codex.extract' })
    const metadataRequests: Array<{ url: string; method: string | undefined; redirect: RequestRedirect | undefined }> = []
    const unexpectedMetadataRequests: typeof metadataRequests = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = { url: String(input), method: init?.method, redirect: init?.redirect }
      metadataRequests.push(request)
      if (request.url !== 'https://plan.invalid/api/v1/models' || request.method !== 'GET' || request.redirect !== 'error') {
        unexpectedMetadataRequests.push(request)
        throw new Error('unexpected synthetic metadata request')
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const assessmentContext = await freezeAIRequestAssessmentContextV2(resolution)
    const built = await buildCodexExtractionPlanV2({ root, sourceText, material, assessmentContext, options: {},
      render: chunk => [{ role: 'system', content: baseline.rawText }, { role: 'user', content: chunk.text }],
      prepareRange: (messages, options) => prepareAIRequestV2({ resolution, assessmentContext, messages, options,
        stream: false, contextMaterial: material, lengthPlan: null, explicitConstraints: null }) })
    expect(built.plan.frames).toHaveLength(1)
    expect(built.plan.frames[0].request.capacity).toMatchObject({ contextTokens: null, inputTokens: null, outputTokens: null })
    expect(built.plan.frames[0]).toMatchObject({ startChar: 0, endChar: sourceText.length })
    expect(built.plan.frames[0].sourceRangeHash).toBe(await hashCanonicalValue(sourceText))
    await expect(assertCodexExtractionPlanV2(built.plan)).resolves.toBeUndefined()

    const serviceConfig: AIConfig = { ...config, modelCapacity: { ...getModelCapacityV1(config), confidence: 'service',
      inputLimit: 1, totalWindow: null, outputLimit: 128, outputLimitSource: 'service' } }
    const serviceResolution = resolveRequestConfig(serviceConfig, { category: 'codex.extract' })
    const exactContext = await freezeAIRequestAssessmentContextV2(serviceResolution, wire => ({
      tokens: wire.length, method: 'synthetic-exact-envelope-meter', version: '1', reliability: 'exact' }))
    let preparedCalls = 0
    await expect(buildCodexExtractionPlanV2({ root, sourceText, material, assessmentContext: exactContext, options: {},
      render: chunk => [{ role: 'system', content: baseline.rawText }, { role: 'user', content: chunk.text }],
      prepareRange: async () => { preparedCalls++; throw new Error('baseline-only impossible request must not be prepared') },
    })).rejects.toThrow()
    expect(preparedCalls).toBe(0); expect(source.rawText).toBe(sourceText)
    const { planHash: _hash, ...broken } = { ...built.plan, sourceUTF16Length: sourceText.length + 1 }
    await expect(assertCodexExtractionPlanV2({ ...broken, planHash: await hashCanonicalValue(broken) })).rejects.toThrow()
    await expect(captureRegisteredContextSourceV2({ sourceKey: 'manualText', context: { ...context, scope: { ...scope, workId: 0 } } })).rejects.toThrow()
    const foreign = await seedCurrentWorkspace('foreign B01 owner')
    await expect(captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionBaseline', context: { ...context, scope: foreign.scope } })).rejects.toThrow()
    await expect(captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionProgressV2', context })).rejects.toThrow()
    expect(metadataRequests).toEqual([{ url: 'https://plan.invalid/api/v1/models', method: 'GET', redirect: 'error' }])
    expect(unexpectedMetadataRequests).toEqual([])
    expect(metadataRequests.filter(request => request.method === 'POST')).toEqual([])
  })

  it('plans proven input overflow only at new-Root frozen source units while unknown full requests remain whole', async () => {
    const { scope } = await seedCurrentWorkspace('B01 safe source units')
    const at = Date.now(), categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(scope, 'codexCategories', { projectId: scope.projectId,
      domain: 'natural', parentId: null, name: '灵植', icon: '🌱', builtInKey: 'herb', fieldSchema: '[]', hidden: false,
      order: 0, createdAt: at, updatedAt: at }, { owner: 'world' }))
    await stampCurrentFixtureResourceUidsV1(scope.projectId)
    const sourceText = '月栖花生于月潮湿地。😀\r\n\r\n'.repeat(4000) + '完整尾部'
    const context = { projectId: scope.projectId, scope, worldGroupId: null, codexCategoryId: categoryId, manualSourceText: sourceText }
    const source = await captureRegisteredContextSourceV2({ sourceKey: 'manualText', context })
    const baseline = await captureRegisteredContextSourceV2({ sourceKey: 'codexExtractionBaseline', context })
    const baselineState = await readCodexExtractionBaselineV1({ scope, categoryId, worldGroupId: null })
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'GET') throw new Error('No inference is allowed while testing a source plan')
      return new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } })
    }))
    // New policy uses the same actual capacity assessment, but every split must
    // be a Root-frozen paragraph boundary. Legacy factory Root above stays absent-policy.
    const safeRoot = await createCodexExtractionRootV2({ source, baseline, baselineStateHash: await hashCanonicalValue(baselineState),
      promptTemplateHash: 'e'.repeat(64), supplementTags: false, newProductionPolicy: true })
    const safeMaterial = await createCodexContextMaterialV2({ root: safeRoot, source, baseline, inputTokenForecast: 0 })
    const splitConfig: AIConfig = { ...config, modelCapacity: { ...getModelCapacityV1(config), confidence: 'service',
      inputLimit: Math.floor(sourceText.length / 2), totalWindow: null, outputLimit: 128, outputLimitSource: 'service' } }
    const splitResolution = resolveRequestConfig(splitConfig, { category: 'codex.extract' })
    const splitContext = await freezeAIRequestAssessmentContextV2(splitResolution, wire => ({
      tokens: wire.length, method: 'synthetic-exact-envelope-meter', version: '1', reliability: 'exact' }))
    const safe = await buildCodexExtractionPlanV2({ root: safeRoot, sourceText, material: safeMaterial, assessmentContext: splitContext, options: {},
      render: chunk => [{ role: 'system', content: baseline.rawText }, { role: 'user', content: chunk.text }],
      prepareRange: (messages, options) => prepareAIRequestV2({ resolution: splitResolution, assessmentContext: splitContext, messages, options,
        stream: false, contextMaterial: safeMaterial, lengthPlan: null, explicitConstraints: null }) })
    expect(safe.plan.frames.length).toBeGreaterThan(1)
    const boundaries = [0, ...safeRoot.productionPolicy!.sourceUnitEnds]
    expect(safe.plan.frames.every(frame => boundaries.includes(frame.startChar) && boundaries.includes(frame.endChar))).toBe(true)
    expect(safe.plan.frames.map(frame => sourceText.slice(frame.startChar, frame.endChar)).join('')).toBe(sourceText)
    await expect(assertCodexExtractionPlanV2(safe.plan)).resolves.toBeUndefined()
    for (const titleSource of ['北辰联邦：\n该国首都玄京，朔日禁用灵力。', '【北辰联邦】\n\n该国首都玄京，朔日禁用灵力。']) {
      const titleCapture = await captureRegisteredContextSourceV2({ sourceKey: 'manualText', context: { ...context, manualSourceText: titleSource } })
      const titleRoot = await createCodexExtractionRootV2({ source: titleCapture, baseline, baselineStateHash: await hashCanonicalValue(baselineState),
        promptTemplateHash: 'e'.repeat(64), supplementTags: false, newProductionPolicy: true })
      const titleMaterial = await createCodexContextMaterialV2({ root: titleRoot, source: titleCapture, baseline, inputTokenForecast: 0 })
      const tinyResolution = resolveRequestConfig({ ...splitConfig, modelCapacity: { ...splitConfig.modelCapacity!, inputLimit: 1 } }, { category: 'codex.extract' })
      const tinyContext = await freezeAIRequestAssessmentContextV2(tinyResolution, wire => ({ tokens: wire.length,
        method: 'synthetic-exact-envelope-meter', version: '1', reliability: 'exact' }))
      let prepared = 0
      await expect(buildCodexExtractionPlanV2({ root: titleRoot, sourceText: titleSource, material: titleMaterial,
        assessmentContext: tinyContext, options: {}, render: chunk => [{ role: 'user', content: chunk.text }],
        prepareRange: async () => { prepared++; throw new Error('No detached heading request may be prepared') },
      })).rejects.toThrow('单个完整原文单元')
      expect(prepared).toBe(0); expect(titleCapture.rawText).toBe(titleSource)
      expect(titleRoot.productionPolicy!.sourceUnitEnds).toEqual([titleSource.length])
    }

  })

  it('refines only the unfinished UTF16 range, preserving CRLF and surrogate pairs without a call-count cutoff', () => {
    const sourceText = '完成区间' + '😀\r\n月潮'.repeat(600) + '尾段'
    const startChar = '完成区间'.length
    const ranges = refineIncompleteCodexRangeV2({ sourceText, startChar, endChar: sourceText.length, completion: 'incomplete' })
    expect(ranges.map(row => row.text).join('')).toBe(sourceText.slice(startChar))
    expect(ranges.every(row => row.startChar >= startChar && row.endChar - row.startChar < sourceText.length - startChar)).toBe(true)
    expect(ranges.some(row => /[\uD800-\uDBFF]$/.test(row.text) || row.text.endsWith('\r'))).toBe(false)
    expect(() => refineIncompleteCodexRangeV2({ sourceText: '😀', startChar: 0, endChar: 2, completion: 'incomplete' })).toThrow()
    let leaves = [{ startChar, endChar: sourceText.length, text: sourceText.slice(startChar) }]
    while (leaves.some(row => row.text.length > 30)) leaves = leaves.flatMap(row => row.text.length > 30
      ? refineIncompleteCodexRangeV2({ sourceText, ...row, completion: 'incomplete' }) : [row])
    expect(leaves.length).toBeGreaterThan(64)
    expect(leaves.map(row => row.text).join('')).toBe(sourceText.slice(startChar))
  })
})
