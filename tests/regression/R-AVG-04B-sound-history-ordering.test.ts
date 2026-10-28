import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import * as transport from '../../src/lib/avg/sound-transport'
import { avgSoundReviewStartFixtureV1 } from '../helpers/avg-sound-review-fixture'
import { adoptAvgSoundArtifactV1, adoptAvgSoundSourcesV1, acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { mockAvgSoundOggDecoderV1 } from '../helpers/avg-sound-decoder-fixture'
import { runAuthorizedProductProductionV1 } from '../../src/lib/product-production/service'
import { assertAvgSoundOtherRequestsKnownV1 } from '../../src/lib/avg/visual-planning-restart'

const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1
const actualTransport = transport.createConfiguredAvgSoundTransportV1
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1',
    apiKey: 'intercepted-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  mockAvgSoundOggDecoderV1()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function readyMusic() {
  const s = await avgSoundReviewStartFixtureV1()
  await adoptAvgSoundSourcesV1(s); await runAuthorizedProductProductionV1(s)
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  return s
}

/** Deterministic scheduling barrier only. Original transport/preflight,
 * source freshness, requests, scheduler writes and failure fences still run. */
async function musicAfterLibrary(s: Awaited<ReturnType<typeof readyMusic>>, outcome: 'accepted' | 'failed') {
  vi.spyOn(transport, 'createConfiguredAvgSoundTransportV1').mockImplementation(input => {
    const actual = actualTransport(input)
    return Object.freeze({ ...actual, request: async (request: Parameters<typeof actual.request>[0]) => {
      if (request.requirement.dispatch.operation === 'generate-music') await vi.waitFor(async () => {
        if (outcome === 'accepted') expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx')).toBeDefined()
        else expect((await db.productBuilds.get(s.buildId))!.status).toBe('recovery-required')
      }, { timeout: 10_000, interval: 10 })
      return actual.request(request)
    } })
  })
  let posts = 0
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/audio/music') && init?.method === 'POST') {
      posts++; throw new TypeError('ENGINEERING original unknown music dispatch after controlled sibling ordering')
    }
    return s.fetcher(url, init)
  })
  const result = await runAuthorizedProductProductionV1(s)
  return { result, posts: () => posts }
}

describe('AVG sound original requests with deterministic concurrent library outcomes', () => {
  it('retains successful actual library production before the one unknown music POST and refuses a fresh scope without replay', async () => {
    const s = await readyMusic(), { result, posts } = await musicAfterLibrary(s, 'accepted')
    expect(result.buildStatus).toBe('recovery-required'); expect(posts()).toBe(1); expect(s.calls).toHaveLength(1)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx')).toBeDefined()
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson)
    expect(ledger.attempts.some((row: { taskKey: string; usageKnown: boolean }) => row.taskKey === 'avg.sound.generate.desk.bgm' && !row.usageKnown)).toBe(true)
    await expect(assertAvgSoundOtherRequestsKnownV1(s.scope, null)).rejects.toThrow(/未知|未完成领取/)
    expect(posts()).toBe(1)
  }, 90_000)

  it('preserves the real missing-AudioContext library failure and refuses a delayed music dispatch after the Build stops', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const failures: Array<string | null> = []
    vi.mocked(verifier.verifyProductMediaRuntimeUrlsV1).mockImplementation(async input => {
      const result = await actualVerifier(input)
      failures.push(...result.assets.map(row => row.failureCode)); return result
    })
    const s = await readyMusic(), { result, posts } = await musicAfterLibrary(s, 'failed')
    expect(failures).toContain('audio-context-unavailable')
    expect(result.buildStatus).toBe('recovery-required'); expect(posts()).toBe(0); expect(s.calls).toHaveLength(1)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx')).toBeUndefined()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    expect(s.wire.fetcher.mock.calls.some(([url]) => String(url).includes('/library/audio/'))).toBe(true)
  }, 90_000)
})
