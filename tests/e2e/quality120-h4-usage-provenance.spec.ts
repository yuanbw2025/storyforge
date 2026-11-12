import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const fixturePath = '/storyforge/src/lib/evals/long-consistency/index.ts'
const model = 'gpt-4o-mini'
const apiKey = 'sfqa120-synthetic-only'

for (const suite of ['h4', 'h85'] as const) {
  const measured = suite === 'h85'
  test(`120 ${suite.toUpperCase()} settings preserves ${measured ? 'complete' : 'missing'} provider usage across reload and signed export`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('SFQA120 requires an isolated loopback server')
    const origin = new URL(baseURL)
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
      throw new Error('SFQA120 refuses non-loopback browser origins')
    }
    const baseUrl = new URL('sfqa120-synthetic/v1', baseURL).href
    const endpoint = `${baseUrl}/chat/completions`
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', acceptDownloads: true })
    try {
      const requests: { model: string; stream: boolean; authorized: boolean }[] = []
      const unexpectedModelRequests: string[] = []
      const transport: { reply?: Record<string, unknown> } = {}
      await context.route('**/*', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (request.url() === endpoint && request.method() === 'POST') {
          const payload = request.postDataJSON()
          requests.push({ model: payload.model, stream: payload.stream, authorized: request.headers().authorization === `Bearer ${apiKey}` })
          if (!transport.reply || requests.length !== 1) return route.abort('blockedbyclient')
          return route.fulfill({ status: 200, json: transport.reply })
        }
        if (/\/chat\/completions|\/(?:responses|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
          unexpectedModelRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
          return route.abort('blockedbyclient')
        }
        if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
        return route.abort('blockedbyclient')
      })
      await context.addInitScript(allowedOrigin => {
        if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa120-isolated')
      }, origin.origin)
      const page = await context.newPage()
      await page.goto('./')
      const seed = await page.evaluate(async ({ suite, fixturePath, baseUrl, model, apiKey }) => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const [evals, { useAIConfigStore }] = await Promise.all([
          load<typeof import('../../src/lib/evals/long-consistency')>(fixturePath),
          load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
        ])
        useAIConfigStore.getState().setConfig({ provider: 'openai', model, apiKey, baseUrl,
          temperature: 0, maxTokens: 6_000, contextWindow: 128_000 })
        const isH4 = suite === 'h4'
        const fixture = evals.H4_LONG_CONSISTENCY_FIXTURES_V1.find(item =>
          item.split === 'development' && (isH4 ? item.hiddenLabels.cleanControl : item.hiddenLabels.expectedIssues.length === 1))
        if (!fixture) throw new Error('Missing the real one-fixture development control')
        const verifier = { provider: 'openai', model, promptVersion: evals.LONG_CONSISTENCY_CURRENT_JUDGE_PROMPT_VERSION_V1 }
        const discoveryRunId = 'sfqa120-native-discovery'
        const runId = isH4 ? discoveryRunId : 'sfqa120-native-adjudication'
        const stopped = new Error('Stop after the signed initial checkpoint is persisted')
        const noDispatch = async () => { throw new Error('Checkpoint preparation must not dispatch') }
        const discovery = evals.runH4LongConsistencyVerifierV1({
          runId: discoveryRunId, split: 'development', codeRevision: 'sfqa120-isolated-native', fixtureIds: [fixture.id],
          execution: { generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: evals.H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1 }, verifier },
          maxAttemptsPerFixture: 1,
          call: isH4 ? noDispatch : async () => ({
            output: JSON.stringify({ schemaVersion: 1, issues: fixture.hiddenLabels.expectedIssues.map((issue, index) => ({
              ...issue, id: `isolated-${index}`, summary: '仅根据两个逐字证据判定。',
            })) }),
            usage: { inputTokens: 30, outputTokens: 10, durationMs: 1, costUsd: 0.001,
              provenance: { input: 'provider', output: 'provider', providerTotalTokens: 40, cost: 'catalog-estimate' } },
          }),
          onCheckpoint: isH4 ? async checkpoint => {
            await evals.persistH4LongConsistencyBrowserCheckpointV1(checkpoint)
            throw stopped
          } : undefined,
        })
        async function expectPaused(run: Promise<unknown>) {
          try { await run } catch (cause) {
            if (cause === stopped) return
            throw cause
          }
          throw new Error('Expected runner to stop before its first attempt')
        }
        if (isH4) {
          await expectPaused(discovery)
          return { runId, output: { schemaVersion: 1, issues: [] }, parentHash: null }
        }
        const parent = await discovery
        if (parent.status !== 'completed') throw new Error('Expected a signed completed H4 parent')
        await evals.persistH4LongConsistencyBrowserCheckpointV1(parent)
        await expectPaused(evals.runH4SubtypeAdjudicationV1({
          runId, codeRevision: 'sfqa120-isolated-native', baseCheckpoint: parent,
          adjudicator: { ...verifier, promptVersion: evals.H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1 },
          maxAttemptsPerFixture: 1, call: noDispatch,
          onCheckpoint: async checkpoint => {
            await evals.persistH4SubtypeAdjudicationBrowserCheckpointV1(checkpoint)
            throw stopped
          },
        }))
        return { runId, parentHash: parent.checkpointHash, output: { schemaVersion: 1, decisions: [{
          candidateId: 'candidate-01', verdict: 'conflict', subtype: fixture.hiddenLabels.expectedIssues[0].subtype,
          reason: '两个逐字证据满足操作定义。',
        }] } }
      }, { suite, fixturePath, baseUrl, model, apiKey })
      expect(requests).toHaveLength(0)
      transport.reply = {
        choices: [{ message: { role: 'assistant', content: JSON.stringify(seed.output) }, finish_reason: 'stop' }],
        ...(measured ? { usage: { prompt_tokens: 200, completion_tokens: 0, total_tokens: 200 } } : {}),
      }
      await page.goto('./home/settings')
      const development = page.getByTestId(`${suite}-development-section`)
      const score = development.getByTestId(`${suite}-development-score`)
      const counts = measured ? '实测 2 · 缺完整实测 0' : '实测 0 · 缺完整实测 1'
      await development.getByRole('button', { name: measured ? '继续判类' : '继续', exact: true }).click()
      await expect(score.getByText(counts, { exact: true })).toBeVisible()
      if (measured) await expect(score).not.toContainText('usage-evidence-missing')
      else await expect(score).toContainText('usage-evidence-missing')

      const downloadButton = development.getByRole('button', {
        name: measured ? '导出 H85 两阶段判类 Development' : '导出 H4 Development', exact: true,
      })
      const downloadPromise = page.waitForEvent('download')
      await downloadButton.click()
      const path = await (await downloadPromise).path()
      if (!path) throw new Error('Expected actual browser checkpoint download')
      const raw = await readFile(path, 'utf8')

      await page.reload()
      await expect(score.getByText(counts, { exact: true })).toBeVisible()
      if (measured) await expect(score).not.toContainText('usage-evidence-missing')
      else await expect(score).toContainText('usage-evidence-missing')
      const restored = await page.evaluate(async ({ suite, fixturePath, raw }) => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const evals = await load<typeof import('../../src/lib/evals/long-consistency')>(fixturePath)
        if (suite === 'h4') {
          const [downloaded, persisted] = await Promise.all([
            evals.importH4LongConsistencyRunCheckpointV1(raw), evals.loadH4LongConsistencyBrowserStateV1('development'),
          ])
          return { downloaded, persisted: persisted?.checkpoint, gateFailures: persisted?.score.gate.failures,
            usage: downloaded.completed[0]?.artifact.execution.verifierUsage, parentHash: null }
        }
        const [downloaded, persisted] = await Promise.all([
          evals.importH4SubtypeAdjudicationCheckpointV1(raw), evals.loadH4SubtypeAdjudicationBrowserStateV1('development'),
        ])
        return { downloaded, persisted: persisted?.checkpoint, gateFailures: persisted?.score.gate.failures,
          usage: downloaded.calls[0]?.usage, parentHash: downloaded.baseCheckpointHash }
      }, { suite, fixturePath, raw })
      expect(restored.downloaded).toEqual(restored.persisted)
      expect(restored.downloaded).toMatchObject({ runId: seed.runId, status: 'completed', completed: [expect.anything()] })
      expect(restored.parentHash).toBe(seed.parentHash)
      expect(restored.gateFailures?.includes('usage-evidence-missing')).toBe(!measured)
      expect(restored.usage?.provenance).toEqual(measured
        ? { input: 'provider', output: 'provider', providerTotalTokens: 200, cost: 'catalog-estimate' }
        : { input: 'estimated', output: 'estimated', providerTotalTokens: null, cost: 'catalog-estimate' })
      if (measured) expect(restored.usage).toMatchObject({ inputTokens: 200, outputTokens: 0 })
      else {
        expect(restored.usage?.inputTokens).toBeGreaterThan(0)
        expect(restored.usage?.outputTokens).toBeGreaterThan(0)
        await expect(page.getByTestId('h4-held-out-section').getByRole('button', { name: '运行', exact: true })).toBeDisabled()
      }
      expect(requests).toEqual([{ model, stream: false, authorized: true }])
      expect(unexpectedModelRequests).toEqual([])
    } finally {
      await context.close()
    }
  })
}
