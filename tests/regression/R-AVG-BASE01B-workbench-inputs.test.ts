import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { clearAvgVisualBatchDraftV1, prepareAvgAssemblyBriefV1, saveAvgVisualBatchDraftV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'

const image = (key = 'first'): AvgVisualProductionRequirementV1 => ({ requirementKey: `letter.icon.${key}`, revision: 1,
  assetKey: `avg.generated.icon.${key}`, name: '信封图标', altText: '原创信封工程图标', family: { subjectKey: 'letter', familyKey: 'letter.original', variantKey: key, revision: 1 },
  consumer: { consumerKey: 'letter.icon', domain: 'inventory', slot: 'icon', subjectKey: 'letter', sceneKey: null, lineKey: null, required: true, fallback: 'none' },
  triggerBeatKey: null, itemVariantKey: null, mediaKind: 'ui', prompt: '原创信封图标', negativePrompt: '', invariants: [], forbiddenDepictions: [],
  width: 512, height: 512, resolutionTier: '1K', alpha: 'not-required', references: [] })
const workspace = (json: string) => JSON.parse(json) as ReturnType<typeof createAvgAuthoringPresetV1>

describe('AVG media workbench pending requirements lifecycle', () => {
  beforeEach(async () => {
    await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-no-network', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No HTTP is authorized by draft editing') }))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

  it('replacing a pending item image removes only its old unconsumed slot proposal and preserves gameplay', async () => {
    const original = createAvgAuthoringPresetV1(), s = await prepareNativeAvgAssembly(original)
    const first = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      batchKey: 'author.icons', revision: 1, requirements: [image()] })
    const second = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: first.revision,
      batchKey: 'author.icons', revision: 2, requirements: [image('revised')] })
    const next = workspace(second.editorJson!)
    expect(next.systemPlan.version).toBe(2)
    if (next.systemPlan.version !== 2 || original.systemPlan.version !== 2) throw new Error('inventory fixture missing')
    expect(next.systemPlan.inventory.items[0].iconAssetKey).toBe('avg.generated.icon.revised')
    expect(next.systemPlan.inventory.items[0].variants).toEqual(original.systemPlan.inventory.items[0].variants)
    expect(next.systemPlan.actions).toEqual(original.systemPlan.actions)
    expect(next.scripts).toEqual(original.scripts)
    expect(next.presentation).toEqual(original.presentation)
    expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explicit removal uses draft CAS, clears an unused declaration and retains imported reference bytes', async () => {
    const s = await prepareNativeAvgAssembly(createAvgAuthoringPresetV1())
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)).buffer
    const ref = await importAvgMediaV1({ scope: s.scope, data: png, mimeType: 'image/png', kind: 'background', name: '原创参考', altText: '工程参考', license: 'CC0-1.0', characterTag: '' })
    const saved = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      batchKey: 'author.icons', revision: 1, requirements: [image()] })
    await expect(clearAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision - 1 })).rejects.toThrow(/已变化/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    const cleared = await clearAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const next = workspace(cleared.editorJson!)
    expect(next).not.toHaveProperty('mediaBatch')
    if (next.systemPlan.version !== 2) throw new Error('inventory fixture missing')
    expect(next.systemPlan.inventory.items[0].iconAssetKey).toBeNull()
    expect(await db.avgDraftMedia.count()).toBe(1)
    expect((await db.mediaBlobObjects.toArray())[0].contentHash).toBe(ref.contentHash)
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: cleared.revision })
    expect(prepared.executionBrief!.avgAssembly!.version).toBe(1)
    expect(prepared.executionBrief!.productionBudget.maximumMediaCalls).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an actually started media Build cannot be erased by clearing the draft batch', async () => {
    const s = await prepareNativeAvgAssembly(createAvgAuthoringPresetV1())
    const saved = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      batchKey: 'author.icons', revision: 1, requirements: [image()] })
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    const before = await readAvgDraftV1(s.scope), builds = await db.productBuilds.toArray()
    await expect(clearAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: before.revision })).rejects.toThrow(/已开始/)
    expect(await readAvgDraftV1(s.scope)).toEqual(before)
    expect(await db.productBuilds.toArray()).toEqual(builds)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a corrupted foreign production pointer cannot authorize batch removal or touch either Work', async () => {
    const s = await prepareNativeAvgAssembly(createAvgAuthoringPresetV1()), foreign = await prepareNativeAvgAssembly(createAvgAuthoringPresetV1())
    const saved = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      batchKey: 'author.icons', revision: 1, requirements: [image()] })
    await db.avgAuthoringDrafts.update(saved.id!, { productionId: foreign.productionId })
    const before = await db.avgAuthoringDrafts.toArray(), productions = await db.productProductions.toArray()
    await expect(clearAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision })).rejects.toThrow(/跨作品/)
    expect(await db.avgAuthoringDrafts.toArray()).toEqual(before)
    expect(await db.productProductions.toArray()).toEqual(productions)
    expect(fetch).not.toHaveBeenCalled()
  })
})
