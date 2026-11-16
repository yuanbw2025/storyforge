import { inflateSync } from 'node:zlib'
import type { ChatResult } from '../../src/lib/ai/client'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveConfiguredTextCapabilityV1,
  runConfiguredProductionTextV1,
  runConfiguredProductionVisionV1,
} from '../../src/lib/product-production/capabilities'
import { db } from '../../src/lib/db/schema'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { useAIConfigStore } from '../../src/stores/ai-config'
import {
  authorizeSFQA050ProductionV1,
  captureSFQA050RequestV1,
  changeSFQA050ConfigurationV1,
  SFQA050_CONFIG_CHANGES,
  installSFQA050RouteV1,
  SFQA050_CONFIG_A,
  SFQA050_CONFIG_B,
  sfqa050ImageV1,
  sfqa050ResponseV1,
  sfqa050VisionTaskV1,
  type SFQA050CapturedRequestV1,
} from '../helpers/sfqa050-provider-dispatch-binding'

const scope = { projectId: 7, category: 'product-production', requirementKey: 'text.runtime-package' }
const messages = [{ role: 'user' as const, content: '只读取已确认的受控制作输入。' }]

describe('SFQA050 · original frozen provider reaches the real dispatch', () => {
  let previous: Pick<ReturnType<typeof useAIConfigStore.getState>, 'config' | 'presets' | 'taskRoutes'>
  beforeEach(async () => {
    await db.delete(); await db.open()
    window.location.href = 'http://localhost:4178/storyforge/'
    const state = useAIConfigStore.getState()
    previous = { config: state.config, presets: state.presets, taskRoutes: state.taskRoutes }
    useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A }, presets: [], taskRoutes: {} })
  })
  afterEach(() => { vi.restoreAllMocks(); useAIConfigStore.setState(previous); db.close() })

  function transport(output: string | ((body: Record<string, unknown>) => string) = '{"ok":true}') {
    const requests: SFQA050CapturedRequestV1[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push(captureSFQA050RequestV1(input, init))
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return sfqa050ResponseV1(typeof output === 'function' ? output(body) : output)
    })
    return requests
  }

  it('does not re-resolve vision to global route B after capability A has been validated', async () => {
    const config = { ...SFQA050_CONFIG_A }
    const frozen = await resolveConfiguredTextCapabilityV1(scope, { resolveConfig: () => config, now: () => 100 })
    const requests = transport()
    const response = await runConfiguredProductionVisionV1({
      ...scope, expectedCapabilityHash: frozen.receipt.capabilityHash,
      messages, images: [await sfqa050ImageV1()], maximumOutputTokens: 256,
    }, {
      resolveConfig: () => config,
      now: () => { installSFQA050RouteV1(SFQA050_CONFIG_B); return 101 },
    })
    expect(requests).toEqual([{
      url: `${SFQA050_CONFIG_A.baseUrl}/chat/completions`, model: SFQA050_CONFIG_A.model,
      temperature: SFQA050_CONFIG_A.temperature, maximumOutputTokens: 256,
    }])
    expect(response.bindingReceipt.capabilityHash).toBe(frozen.receipt.capabilityHash)
    expect(response.bindingReceipt.model).toBe(requests[0]!.model)
  })

  it('captures caller config before hashing instead of dispatching a mutated B with receipt A', async () => {
    const config = { ...SFQA050_CONFIG_A }
    const frozen = await resolveConfiguredTextCapabilityV1(scope, { resolveConfig: () => config, now: () => 100 })
    const requests = transport()
    const response = await runConfiguredProductionTextV1({
      ...scope, expectedCapabilityHash: frozen.receipt.capabilityHash, messages, maximumOutputTokens: 256,
    }, {
      resolveConfig: () => config,
      now: () => { Object.assign(config, SFQA050_CONFIG_B); return 101 },
    })
    expect(requests).toEqual([{
      url: `${SFQA050_CONFIG_A.baseUrl}/chat/completions`, model: SFQA050_CONFIG_A.model,
      temperature: SFQA050_CONFIG_A.temperature, maximumOutputTokens: 256,
    }])
    expect(response.bindingReceipt.capabilityHash).toBe(frozen.receipt.capabilityHash)
    expect(response.bindingReceipt.model).toBe(requests[0]!.model)
  })

  it.each((['avg', 'general', 'ttrpg-open'] as const).flatMap(kind => SFQA050_CONFIG_CHANGES.map(change => [kind, change] as const)))('%s scheduler rejects changed %s before the actual default executor sends', async (kind, change) => {
    const owned = await authorizeSFQA050ProductionV1(kind)
    const requests = transport()
    let entered = 0
    await runProductProductionUntilBlockedV1({ ...owned, executor: async input => {
      entered += 1
      changeSFQA050ConfigurationV1(change)
      return owned.executor(input)
    } })
    expect(entered).toBeGreaterThan(0)
    expect(requests).toEqual([])
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    expect(build.status).toBe('recovery-required')
    const callsBefore = requests.length
    await runProductProductionUntilBlockedV1({ ...owned })
    expect(requests).toHaveLength(callsBefore)
  }, 30_000)

  it.each((['preflight', 'review'] as const).flatMap(kind => SFQA050_CONFIG_CHANGES.map(change => [kind, change] as const)))('vision %s rejects changed %s at the real default transport before dispatch', async (kind, change) => {
    const owned = await sfqa050VisionTaskV1(kind)
    changeSFQA050ConfigurationV1(change)
    const requests = transport()
    const failure = await owned.executor(owned.execution).then(() => null, error => error as Error)
    expect(requests).toEqual([])
    expect(failure?.message).toMatch(/binding.*capability/)
  }, 30_000)

  it.each((['text', 'vision'] as const).flatMap(mode => SFQA050_CONFIG_CHANGES.map(change => [mode, change] as const)))('%s capability rejects changed %s before dispatch', async (mode, change) => {
    const frozen = await resolveConfiguredTextCapabilityV1(scope)
    changeSFQA050ConfigurationV1(change)
    const requests = transport()
    const result: ChatResult = { usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 } }
    const input = { ...scope, messages, maximumOutputTokens: 256, expectedCapabilityHash: frozen.receipt.capabilityHash, result }
    const call = mode === 'text' ? runConfiguredProductionTextV1(input)
      : runConfiguredProductionVisionV1({ ...input, images: [await sfqa050ImageV1()] })
    await expect(call).rejects.toThrow(/binding.*capability/)
    expect(requests).toEqual([])
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 45, totalTokens: 135 })
  })

  it.each(['text', 'vision'] as const)('%s dispatches unchanged A once with an exact matching receipt and observed usage', async mode => {
    const frozen = await resolveConfiguredTextCapabilityV1(scope)
    const requests = transport()
    const result: ChatResult = {}
    const input = { ...scope, messages, maximumOutputTokens: 256, expectedCapabilityHash: frozen.receipt.capabilityHash, result }
    const response = mode === 'text' ? await runConfiguredProductionTextV1(input)
      : await runConfiguredProductionVisionV1({ ...input, images: [await sfqa050ImageV1()] })
    expect(response.output).toBe('{"ok":true}')
    expect(response.bindingReceipt).toMatchObject({ capabilityHash: frozen.receipt.capabilityHash,
      provider: SFQA050_CONFIG_A.provider, model: SFQA050_CONFIG_A.model, endpointOrigin: 'https://sfqa050-a.invalid' })
    expect(requests).toEqual([{ url: `${SFQA050_CONFIG_A.baseUrl}/chat/completions`, model: response.bindingReceipt.model,
      temperature: SFQA050_CONFIG_A.temperature, maximumOutputTokens: 256 }])
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  it.each(['text', 'vision'] as const)('%s snapshots the resolved config before the first asynchronous hash yields', async mode => {
    const frozen = await resolveConfiguredTextCapabilityV1(scope)
    const config = { ...SFQA050_CONFIG_A }, requests = transport()
    const dependencies = { resolveConfig: () => {
      queueMicrotask(() => Object.assign(config, SFQA050_CONFIG_B))
      return config
    } }
    const input = { ...scope, messages, maximumOutputTokens: 256, expectedCapabilityHash: frozen.receipt.capabilityHash }
    const response = mode === 'text' ? await runConfiguredProductionTextV1(input, dependencies)
      : await runConfiguredProductionVisionV1({ ...input, images: [await sfqa050ImageV1()] }, dependencies)
    expect(config.model).toBe(SFQA050_CONFIG_B.model)
    expect(response.bindingReceipt.capabilityHash).toBe(frozen.receipt.capabilityHash)
    expect(requests).toEqual([{ url: `${SFQA050_CONFIG_A.baseUrl}/chat/completions`, model: SFQA050_CONFIG_A.model,
      temperature: SFQA050_CONFIG_A.temperature, maximumOutputTokens: 256 }])
  })

  it.each(['preflight', 'review'] as const)('vision %s permits unchanged A and retains the original image inputs and usage', async kind => {
    const owned = await sfqa050VisionTaskV1(kind)
    const originals = structuredClone(owned.execution.inputArtifacts)
    const blobs = await db.mediaBlobObjects.toArray()
    const requests = transport(kind === 'review' ? owned.output : body => {
      const wire = body.messages as Array<{ content: unknown }>
      const content = wire[wire.length - 1]!.content as Array<{ type: string; image_url?: { url: string } }>
      const image = content.find(part => part.type === 'image_url')!.image_url!.url
      return JSON.stringify({ schema: 'storyforge.text-adventure-vision-capability-preflight-model-output', version: 1,
        observedQuadrants: decodeSFQA050Quadrants(image) })
    })
    const result = await owned.executor(owned.execution)
    expect(result.usage).toMatchObject({ modelCalls: 1, inputTokens: 10, outputTokens: 5 })
    expect(result.artifacts).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ model: SFQA050_CONFIG_A.model, url: `${SFQA050_CONFIG_A.baseUrl}/chat/completions`, temperature: SFQA050_CONFIG_A.temperature })
    installSFQA050RouteV1(SFQA050_CONFIG_B)
    await expect(owned.executor(owned.execution)).rejects.toThrow(/binding.*capability/)
    expect(requests).toHaveLength(1)
    expect(owned.execution.inputArtifacts).toEqual(originals)
    expect(await db.mediaBlobObjects.toArray()).toEqual(blobs)
    expect(result.usage).toMatchObject({ modelCalls: 1, inputTokens: 10, outputTokens: 5 })
  }, 30_000)

  it.each(['avg', 'general', 'ttrpg-open'] as const)('%s keeps received raw output and paid usage when configuration later changes, without another request', async kind => {
    const owned = await authorizeSFQA050ProductionV1(kind)
    const original = '{"sfqa050":"original paid response retained before candidate parsing"}'
    const requests = transport(original)
    await runProductProductionUntilBlockedV1(owned)
    const initialBuild = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    expect(requests.length, initialBuild.failureJson).toBeGreaterThan(0)
    expect(requests.every(request => request.model === SFQA050_CONFIG_A.model && request.url.startsWith(SFQA050_CONFIG_A.baseUrl))).toBe(true)
    const events = await db.agentRunEvents.toArray()
    const raw: string[] = []
    for (const run of await db.agentRuns.where('projectId').equals(owned.scope.projectId).toArray()) {
      for (const event of (await readAgentRunV1(owned.scope, run.id!)).events) if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response') {
        raw.push(await readAgentRunArtifactExactV1({ projectId: owned.scope.projectId, artifactKind: 'raw-response', contentHash: event.payload.contentHash }))
      }
    }
    expect(raw.length).toBeGreaterThan(0)
    expect(raw.every(value => value === original)).toBe(true)
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    const ledger = JSON.parse(build.budgetLedgerJson) as { attempts: Array<{ usage: { modelCalls: number; inputTokens: number; outputTokens: number } }> }
    expect(ledger.attempts.some(attempt => attempt.usage.modelCalls === 1 && attempt.usage.inputTokens === 10 && attempt.usage.outputTokens === 5)).toBe(true)
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const count = requests.length
    installSFQA050RouteV1(SFQA050_CONFIG_B)
    await runProductProductionUntilBlockedV1(owned)
    expect(requests).toHaveLength(count)
    expect(await db.agentRunEvents.toArray()).toEqual(events)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()).toEqual(artifacts)
    expect((await db.productBuilds.get(build.id!))!.budgetLedgerJson).toBe(build.budgetLedgerJson)
  }, 30_000)

})


/** Decode the attached preflight PNG itself, not labels from its prompt. */
function decodeSFQA050Quadrants(dataUrl: string): string[] {
  const png = Buffer.from(dataUrl.split(',')[1]!, 'base64'), chunks: Buffer[] = []
  let offset = 8, width = 0
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IHDR') width = png.readUInt32BE(offset + 8)
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  expect(width).toBe(64)
  const raw = inflateSync(Buffer.concat(chunks)), stride = 1 + width * 3
  const labels = new Map([['0,0,0', 'black'], ['0,0,255', 'blue'], ['0,255,255', 'cyan'], ['0,255,0', 'green'],
    ['255,0,255', 'magenta'], ['255,0,0', 'red'], ['255,255,255', 'white'], ['255,255,0', 'yellow']])
  return [[16, 16], [48, 16], [16, 48], [48, 48]].map(([x, y]) => {
    const index = y * stride + 1 + x * 3, label = labels.get([...raw.subarray(index, index + 3)].join(','))
    if (!label) throw new Error('SFQA050 attached PNG has no valid quadrant color')
    return label
  })
}
