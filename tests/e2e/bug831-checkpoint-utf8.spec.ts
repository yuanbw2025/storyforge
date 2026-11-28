import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })

test('Unicode checkpoint artifact survives real browser reload and still rejects changed content', async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+\/storyforge\/$/.test(baseURL)) throw new Error('Isolated loopback server required')
  const origin = new URL(baseURL).origin
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort('blockedbyclient')
  })
  const title = 'BUG831 独立检查点作品'
  await createLongform(page, title)
  const saved = await page.evaluate(async title => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope }, { createAgentRunV1 }, checkpoints, hashes, revision] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/workspace/scope.ts'),
      load('/storyforge/src/lib/agent/run/event-store.ts'), load('/storyforge/src/lib/agent/run/checkpoint.ts'),
      load('/storyforge/src/lib/agent/run/hash.ts'), load('/storyforge/src/lib/agent/run/quality-revision-durable.ts'),
    ])
    const work = await db.works.filter((row: { title: string }) => row.title === title).first()
    if (!work) throw new Error('UI-created synthetic Work missing')
    const scope = await resolveScope({ projectId: work.projectId, worldId: work.worldId, workId: work.id })
    const run = await createAgentRunV1({ scope, worldGroupId: null, contract: {
      version: 1, runtimeBindingHash: 'b'.repeat(64), objective: 'Unicode检查点完整往返',
      workflowKind: 'long-running-resumable', scope: { projectId: scope.projectId, worldGroupId: null },
      permissions: { contextSourceKeys: ['ragSelection'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'revision.output', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'revision.terminal', kind: 'terminal', verifier: 'terminal-v1', criterionIds: ['revision.output'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    const sourceHtml = `<p>${'汉😀é'.repeat(300_000)}</p>\ud800尾部😀`
    const draft = { version: 'quality-revision-draft-v1', sourceHtml, contentHtml: sourceHtml, outputText: '完整尾部', rawPatches: [] }
    const expectedHash = await hashes.hashCanonicalValue(draft)
    const expectedBytes = new TextEncoder().encode(hashes.canonicalStringify(draft)).byteLength
    await checkpoints.createAgentRunCheckpointV1({ scope, runId: run.run.id, ...revision.qualityRevisionCheckpointPayloadV1({ resumePayload: draft }) })
    const row = await db.agentRunCheckpoints.where('runId').equals(run.run.id).last()
    const ref = JSON.parse(row.resumePayloadJson)
    const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([scope.projectId, ref.artifactKind, ref.contentHash]).first()
    return { scope, runId: run.run.id, expectedHash, expectedBytes, artifactId: artifact.id,
      referenceBytes: new TextEncoder().encode(row.resumePayloadJson).byteLength, referenceKind: ref.kind }
  }, title)
  expect(saved.referenceBytes).toBeLessThan(4 * 1024)
  expect(saved.referenceKind).toBe('agent-run-checkpoint-artifact-v1')
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  const restored = await page.evaluate(async saved => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, checkpoints, hashes, { agentRunUtf8ByteLengthV1 }, { readAgentRunV1 }] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/agent/run/checkpoint.ts'),
      load('/storyforge/src/lib/agent/run/hash.ts'), load('/storyforge/src/lib/agent/run/checkpoint-contract.ts'),
      load('/storyforge/src/lib/agent/run/event-store.ts'),
    ])
    const verified = await checkpoints.readLatestVerifiedAgentRunCheckpointV1(saved.scope, saved.runId)
    const result = { hash: await hashes.hashCanonicalValue(verified.resumePayload),
      byteLength: agentRunUtf8ByteLengthV1(hashes.canonicalStringify(verified.resumePayload)),
      tailPreserved: verified.resumePayload.sourceHtml.endsWith('</p>\ud800尾部😀'),
      modelRequested: (await readAgentRunV1(saved.scope, saved.runId)).events.some((event: { type: string }) => event.type === 'model.requested'),
      corruptionRejected: '' }
    const artifact = await db.agentRunArtifacts.get(saved.artifactId)
    await db.agentRunArtifacts.update(saved.artifactId, { content: artifact.content.replace('完整尾部', '改变尾部') })
    try { await checkpoints.readLatestVerifiedAgentRunCheckpointV1(saved.scope, saved.runId) }
    catch (error) { result.corruptionRejected = error instanceof Error ? error.message : String(error) }
    return result
  }, saved)
  expect(restored.hash).toBe(saved.expectedHash)
  expect(restored.byteLength).toBe(saved.expectedBytes)
  expect(restored.tailPreserved).toBe(true)
  expect(restored.modelRequested).toBe(false)
  expect(restored.corruptionRejected).toContain('全文 hash 或长度不匹配')
})
