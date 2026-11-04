import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCreatorBriefStudio from '../../src/components/text-game/TextOpenWorldCreatorBriefStudio'
import { db } from '../../src/lib/db/schema'
import { importProjectJSON } from '../../src/lib/export/json-export'
import {
  confirmTextOpenWorldCreatorBriefV1,
  recoverLatestTextOpenWorldCreatorBriefSessionV1,
  startTextOpenWorldCreatorBriefSessionV1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import { createTextOpenWorldCreatorSourceLocatorV1 } from '../../src/lib/open-world/creator-brief-persistence'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/open-world/creator-production-preflight'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../../src/lib/open-world/creator-production-start'
import { assertTextOpenWorldBuildNewWorkV1 } from '../../src/lib/open-world/source-admission'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import {
  authorizeTextOpenWorldCreatorProductionStartV1,
  previewTextOpenWorldCreatorProductionStartV1,
  stopProductProductionV1,
} from '../../src/lib/product-production/service'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const acknowledgements = {
  sourceIdentityReviewed: true,
  productBoundaryReviewed: true,
  unresolvedItemsClosed: true,
  directPublishWorkflowReviewed: true,
} as const

const aiConfig: AIConfig = {
  provider: 'deepseek', apiKey: 'isolated-097-no-real-key', model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, maxTokens: 0,
}
const originalAIState = useAIConfigStore.getState()

async function authorize(session: TextOpenWorldCreatorBriefSessionV1, authorizationNonce: string) {
  const brief = session.confirmedBrief!
  const provider = { projectId: session.scope.projectId, aiConfig, rememberApiKey: false }
  const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
    brief, ...provider, pricing: { mode: 'catalog' },
  })
  const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
    brief, preflight, ...provider,
    acknowledgement: { credentialPolicyReviewed: true, providerAndModelReviewed: true,
      priceAndBudgetReviewed: true, mediaCostBoundaryReviewed: true },
  })
  const input = {
    scope: session.scope, productionId: session.production.id, briefRevision: brief.revision,
    briefHash: brief.briefHash, expectedStateRevision: session.production.stateRevision,
    sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(session.selection!), preflight, confirmation,
    rightsBasis: 'author-owned' as const, rightsNote: '使用本测试合成封存世界。',
    authorizationNonce, authorizedAt: Date.now(),
  }
  const preview = await previewTextOpenWorldCreatorProductionStartV1(input)
  const receipt = await authorizeTextOpenWorldCreatorProductionStartV1({
    ...input, expectedPlanHash: preview.start.productionPlanHash,
  })
  expect(receipt).toMatchObject({ ok: true, replayed: false })
  return { preview, receipt }
}

async function startSession() {
  const { scope, release } = await seedCurrentProductWorld('SFQA097 frozen source')
  const locator = { localReleaseRecordId: release.id!, expectedReleaseHash: release.contentHash }
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({ scope, ...locator })
  return startTextOpenWorldCreatorBriefSessionV1({
    selection: { sourceKind: 'world-release', sourceScope: scope, ...locator, preview },
    sessionKey: 'ending-count',
  })
}

async function productionFootprint() {
  return {
    runs: await db.agentRuns.toArray(),
    briefs: await db.productProductionBriefs.toArray(),
    builds: await db.productBuilds.toArray(),
    artifacts: await db.productBuildArtifacts.toArray(),
  }
}

describe('SFQA097 · Creator 结局数量准入', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({ config: structuredClone(aiConfig), rememberApiKey: false, presets: [], taskRoutes: {} })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No external transport is authorized') }))
  })
  afterEach(() => {
    try { expect(fetch).not.toHaveBeenCalled() }
    finally { db.close(); useAIConfigStore.setState(originalAIState); vi.unstubAllGlobals() }
  })

  it.each([0, 1, 13])('拒绝新确认的 %i 个结局，且不产生候选 Run 或生产记录', async endings => {
    const session = await startSession()
    const before = await productionFootprint()
    await expect(confirmTextOpenWorldCreatorBriefV1({
      session,
      draft: { ...session.draft, scale: { ...session.draft.scale, endings } },
      acknowledgements,
    })).rejects.toThrow(/endings|结局/)
    expect(await productionFootprint()).toEqual(before)
    expect(await db.productProductions.get(session.production.id)).toEqual(
      expect.objectContaining({ status: 'consulting', currentBriefRevision: null }),
    )
  })

  it.each([2, 12])('保存 %i 个结局的新 Creator Brief', async endings => {
    const session = await startSession()
    const confirmed = await confirmTextOpenWorldCreatorBriefV1({
      session,
      draft: { ...session.draft, scale: { ...session.draft.scale, endings } },
      acknowledgements,
    })
    expect(confirmed.confirmedBrief?.draft.scale.endings).toBe(endings)
    expect(await db.productProductionBriefs.count()).toBe(1)
    expect(await db.productBuilds.count()).toBe(0)
  })

  it('在真实 Brief 表单标明范围并拦截不合规结局数', async () => {
    const session = await startSession()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const actKey = 'IS_REACT_ACT_ENVIRONMENT'
    const previousActEnvironment = Reflect.get(globalThis, actKey)
    Reflect.set(globalThis, actKey, true)
    try {
      await act(async () => root.render(createElement(TextOpenWorldCreatorBriefStudio, {
        initialSession: session, onBack: () => {},
      })))
      const input = host.querySelector<HTMLInputElement>('#tow-endings')!
      const confirm = host.querySelector<HTMLButtonElement>('[data-testid="text-open-world-creator-brief-confirm"]')!
      expect(input.min).toBe('2')
      expect(input.max).toBe('12')
      await act(async () => {
        for (const checkbox of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.click()
      })
      expect(confirm.disabled).toBe(false)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      for (const [value, valid] of [[0, false], [1, false], [2, true], [12, true], [13, false]] as const) {
        await act(async () => {
          setter.call(input, String(value))
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        expect(input.getAttribute('aria-invalid'), String(value)).toBe(String(!valid))
        expect(confirm.disabled, String(value)).toBe(!valid)
        if (!valid) expect(host.querySelector('#tow-ending-count-error')?.textContent).toContain('2 至 12 个合规结局')
      }
      expect(await db.productProductionBriefs.count()).toBe(0)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, actKey)
      else Reflect.set(globalThis, actKey, previousActEnvironment)
    }
  })

  it('保留旧单结局 Start 和 Build，停止后由作者修订并授权新 Build', async () => {
    // Exported through the original public confirm → preflight → authorize → backup
    // path on cc6329d78cb53244cf6a4a8705bbeaa0106e69a6 with a synthetic World.
    const archive = JSON.parse(gunzipSync(readFileSync(
      'tests/fixtures/text-open-world/quality097-legacy-one-ending-v1.json.gz',
    )).toString('utf8'))
    const projectId = await importProjectJSON(archive)
    const production = (await db.productProductions.where('projectId').equals(projectId).first())!
    const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
    const briefRow = (await db.productProductionBriefs.where('[productionId+revision]')
      .equals([production.id!, build.briefRevision]).first())!
    const scope = { projectId, worldId: production.worldId, workId: production.workId }
    const frozen = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
    expect(frozen.creatorBrief.draft.scale.endings).toBe(1)
    expect(frozen.executionBrief.scale.targetEndingCount).toBe(1)
    expect(briefRow.briefJson).toBe(archive.productProductionBriefs[0].briefJson)
    expect(briefRow.confirmedBriefJson).toBe(archive.productProductionBriefs[0].confirmedBriefJson)
    expect(frozen.start.startHash).toBe(archive.productProductionBriefs[0].confirmedBriefHash)
    expect(frozen.creatorBrief.briefHash).toBe(archive.productProductionBriefs[0].briefHash)
    const before = await productionFootprint()
    await expect(createTextOpenWorldCreatorProductionPreflightV1({
      brief: frozen.creatorBrief, projectId, aiConfig, rememberApiKey: false, pricing: { mode: 'catalog' },
    })).rejects.toThrow(/2 至 12 个合规结局/)
    await expect(assertTextOpenWorldBuildNewWorkV1({
      scope, productionId: production.id!, buildId: build.id!, operation: '测试新制作',
    })).rejects.toThrow(/2 至 12 个合规结局/)
    const executor = vi.fn(async () => { throw new Error('旧制作不得继续调度') })
    await expect(runProductProductionSchedulerCycleV1({ scope, productionId: production.id!, executor }))
      .rejects.toThrow(/2 至 12 个合规结局/)
    expect(executor).not.toHaveBeenCalled()
    expect(await productionFootprint()).toEqual(before)
    expect(await db.productProductions.get(production.id!)).toEqual(production)

    await stopProductProductionV1({ scope, production })
    const session = await recoverLatestTextOpenWorldCreatorBriefSessionV1([scope])
    expect(session?.confirmedBrief?.briefHash).toBe(frozen.creatorBrief.briefHash)
    expect(session?.production.status).toBe('stopped')
    const revised = await confirmTextOpenWorldCreatorBriefV1({
      session: session!, draft: { ...session!.draft, scale: { ...session!.draft.scale, endings: 2 } },
      acknowledgements,
    })
    expect(revised.confirmedBrief?.revision).toBe(briefRow.revision + 1)
    const { preview } = await authorize(revised, 'sfqa097.revised.start')
    expect(preview.start.executionBrief.scale.targetEndingCount).toBe(2)
    expect(preview.start.startHash).not.toBe(frozen.start.startHash)
    const successor = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([production.id!, build.buildNumber + 1]).first()
    expect(successor).toMatchObject({ parentBuildNumber: build.buildNumber, briefRevision: briefRow.revision + 1 })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({
      status: 'cancelled', planJson: build.planJson, briefHash: build.briefHash,
    })
    expect(await db.productProductionBriefs.get(briefRow.id!)).toMatchObject({
      briefJson: briefRow.briefJson, briefHash: briefRow.briefHash, sourcePlanHash: briefRow.sourcePlanHash,
      confirmedBriefJson: briefRow.confirmedBriefJson, confirmedBriefHash: briefRow.confirmedBriefHash,
    })
  })
})
